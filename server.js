const http = require('http');
const fs   = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
let msgId = 0, userId = 0;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

const wss      = new WebSocket.Server({ server });
const admitted = new Map(); // ws → { id, nickname, icon, isSuperAdmin, isAdmin, firstMsgDone }
const pending  = new Map(); // ws → { id, nickname, icon }

// FIX #3: distinguimos superAdmin (Ruperto) de admin normal (promovido por código)
const isRuperto = n => n.trim().toLowerCase() === 'ruperto';

// FIX #2: el servidor envía ts (timestamp UTC); el cliente formatea con su hora local
const ts  = () => Date.now();
const san = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Broadcast a todos los admitidos; si skip !== null ese ws queda excluido
function broadcastAdmitted(obj, skip = null) {
  for (const [ws] of admitted)
    if (ws !== skip && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
}

// Devuelve el primer ws de un superAdmin activo, o null
function superAdminWs() {
  for (const [ws, u] of admitted) if (u.isSuperAdmin) return ws;
  return null;
}

// Devuelve el primer ws de cualquier admin activo (super o normal), o null
function anyAdminWs() {
  for (const [ws, u] of admitted) if (u.isAdmin || u.isSuperAdmin) return ws;
  return null;
}

function pushUserList() {
  const users = [...admitted.values()].map(u => ({
    id: u.id, nickname: u.nickname, icon: u.icon,
    isAdmin: u.isAdmin, isSuperAdmin: u.isSuperAdmin
  }));
  const pend = [...pending.values()].map(u => ({ id: u.id, nickname: u.nickname, icon: u.icon }));

  for (const [ws, u] of admitted) {
    const isAnyAdmin = u.isAdmin || u.isSuperAdmin;
    send(ws, {
      type: 'user_list',
      users,
      pending: isAnyAdmin ? pend : [],
      count: admitted.size,
      isSuperAdmin: u.isSuperAdmin   // le decimos al cliente si él mismo es superAdmin
    });
  }
}

function doAdmit(ws) {
  const u = pending.get(ws); if (!u) return;
  pending.delete(ws);
  admitted.set(ws, u);
  send(ws, { type: 'admitted' });
  send(ws, { type: 'system', text: `👋 Bienvenido al chat, <strong>${u.nickname}</strong>`, ts: ts() });
  broadcastAdmitted({ type: 'system', text: `👋 <strong>${u.nickname}</strong> se unió al chat`, ts: ts() }, ws);
  pushUserList();
}

// FIX #4: promover a admin a un usuario ya admitido
function promoteToAdmin(ws) {
  const u = admitted.get(ws); if (!u || u.isAdmin || u.isSuperAdmin) return;
  u.isAdmin = true;
  send(ws, { type: 'system', text: '🔑 Ahora eres <strong>administrador</strong> del chat.', ts: ts() });
  pushUserList();
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    /* ── JOIN ── */
    if (m.type === 'join') {
      const nickname    = san(String(m.nickname || '').trim()).slice(0, 24);
      const icon        = String(m.icon || '🧑');
      if (!nickname) return;
      const id          = String(++userId);
      const isSuperAdmin = isRuperto(nickname);
      const isAdmin     = false; // los admins por código se promueven después
      const data        = { id, nickname, icon, isSuperAdmin, isAdmin, firstMsgDone: false };
      const adminConn   = anyAdminWs();

      if (isSuperAdmin || !adminConn) {
        // Entra directo: es Ruperto o no hay ningún admin aún
        admitted.set(ws, data);
        send(ws, { type: 'admitted' });
        send(ws, {
          type: 'system',
          text: `👋 Bienvenido${isSuperAdmin ? ' <strong>(Super Administrador)</strong>' : ''}, <strong>${nickname}</strong>`,
          ts: ts()
        });
        broadcastAdmitted({ type: 'system', text: `👋 <strong>${nickname}</strong> se unió al chat`, ts: ts() }, ws);
        pushUserList();
      } else {
        // Sala de espera
        pending.set(ws, data);
        send(ws, { type: 'waiting', text: 'Solicitud enviada. Esperando que el administrador te admita…' });
        send(adminConn, { type: 'pending_request', id, nickname, icon });
        pushUserList();
      }
      return;
    }

    /* ── LEAVE (FIX #5: salida voluntaria) ── */
    if (m.type === 'leave') {
      const u = admitted.get(ws) || pending.get(ws);
      if (u) {
        send(ws, { type: 'left' }); // confirmación al cliente
        setTimeout(() => ws.close(), 200);
      }
      return;
    }

    /* ── CHAT MESSAGE ── */
    const user = admitted.get(ws);
    if (!user) return;

    if (m.type === 'message') {
      const rawText = String(m.text || '').trim();

      // FIX #4: primer mensaje "1234" → promover a admin (silencioso para el chat)
      if (!user.firstMsgDone) {
        user.firstMsgDone = true;
        if (rawText === '1234') {
          promoteToAdmin(ws);
          return; // no broadcast del código secreto
        }
      }

      const text = san(rawText).slice(0, 500);
      if (!text) return;

      let replyTo = null;
      if (m.replyTo) replyTo = {
        id:       String(m.replyTo.id || ''),
        nickname: san(String(m.replyTo.nickname || '')),
        text:     san(String(m.replyTo.text || '').slice(0, 120)),
      };

      const msg = {
        type: 'message',
        id: String(++msgId),
        nickname: user.nickname,
        icon: user.icon,
        text,
        ts: ts(),   // FIX #2: timestamp UTC en vez de hora del servidor
        replyTo
      };

      // FIX #1: broadcastAdmitted SIN skip → llega a todos incluido el remitente.
      // La línea que causaba el duplicado (send(ws, msg) adicional) se elimina.
      broadcastAdmitted(msg);
      // send(ws, msg); // ← LÍNEA 98 ORIGINAL — ELIMINADA para evitar duplicado
      return;
    }

    /* ── ACCIONES DE ADMIN ── */
    const isAnyAdmin = user.isAdmin || user.isSuperAdmin;
    if (!isAnyAdmin) return;

    if (m.type === 'admit') {
      for (const [pws, pu] of pending) { if (pu.id === m.id) { doAdmit(pws); break; } }
      pushUserList();
      return;
    }

    if (m.type === 'reject') {
      for (const [pws, pu] of pending) {
        if (pu.id === m.id) {
          send(pws, { type: 'rejected', text: 'El administrador ha rechazado tu acceso.' });
          setTimeout(() => pws.close(), 500);
          pending.delete(pws);
          pushUserList();
          break;
        }
      }
      return;
    }

    if (m.type === 'kick') {
      for (const [kws, ku] of admitted) {
        if (ku.id !== m.id) continue;

        // FIX #3: solo un superAdmin puede expulsar a otro admin (no super)
        // Nadie puede expulsar a un superAdmin
        if (ku.isSuperAdmin) return; // nunca se puede echar a Ruperto
        if ((ku.isAdmin) && !user.isSuperAdmin) return; // solo superAdmin echa admins normales

        send(kws, { type: 'kicked', text: 'Has sido expulsado del chat por el administrador.' });
        setTimeout(() => kws.close(), 500);
        admitted.delete(kws);
        broadcastAdmitted({
          type: 'system',
          text: `🚫 <strong>${ku.nickname}</strong> fue expulsado por el administrador.`,
          ts: ts()
        });
        pushUserList();
        break;
      }
      return;
    }

    // FIX #3: superAdmin puede degradar a un admin normal
    if (m.type === 'demote') {
      if (!user.isSuperAdmin) return; // solo Ruperto puede degradar
      for (const [dws, du] of admitted) {
        if (du.id === m.id && du.isAdmin && !du.isSuperAdmin) {
          du.isAdmin = false;
          send(dws, { type: 'system', text: '🔒 Has sido degradado a usuario normal por el administrador.', ts: ts() });
          pushUserList();
          break;
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    const u = admitted.get(ws);
    if (u) {
      admitted.delete(ws);
      broadcastAdmitted({ type: 'system', text: `🚪 <strong>${u.nickname}</strong> salió del chat`, ts: ts() });
      pushUserList();
    }
    if (pending.has(ws)) { pending.delete(ws); pushUserList(); }
  });
});

server.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));
