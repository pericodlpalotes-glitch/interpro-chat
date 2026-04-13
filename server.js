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

const wss    = new WebSocket.Server({ server });
const admitted = new Map(); // ws → {id, nickname, icon, isAdmin}
const pending  = new Map(); // ws → {id, nickname, icon}

const isRuperto = n => n.trim().toLowerCase() === 'ruperto';
const now = () => new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
const san = s => String(s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcastAdmitted(obj, skip = null) {
  for (const [ws] of admitted)
    if (ws !== skip && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify(obj));
}
function adminWs() {
  for (const [ws, u] of admitted) if (u.isAdmin) return ws;
  return null;
}
function pushUserList() {
  const users = [...admitted.values()].map(u => ({ id:u.id, nickname:u.nickname, icon:u.icon, isAdmin:u.isAdmin }));
  const pend  = [...pending.values()].map(u  => ({ id:u.id, nickname:u.nickname, icon:u.icon }));
  for (const [ws, u] of admitted)
    send(ws, { type:'user_list', users, pending: u.isAdmin ? pend : [], count: admitted.size });
}
function doAdmit(ws) {
  const u = pending.get(ws); if (!u) return;
  pending.delete(ws);
  admitted.set(ws, u);
  send(ws, { type:'admitted' });
  send(ws, { type:'system', text:`👋 Bienvenido al chat, <strong>${u.nickname}</strong>`, time:now() });
  broadcastAdmitted({ type:'system', text:`👋 <strong>${u.nickname}</strong> se unió al chat`, time:now() }, ws);
  pushUserList();
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }

    /* JOIN */
    if (m.type === 'join') {
      const nickname = san(String(m.nickname||'').trim()).slice(0,24);
      const icon     = String(m.icon || '🧑');
      if (!nickname) return;
      const id      = String(++userId);
      const isAdmin = isRuperto(nickname);
      const data    = { id, nickname, icon, isAdmin };
      const admin   = adminWs();
      if (isAdmin || !admin) {
        admitted.set(ws, data);
        send(ws, { type:'admitted' });
        send(ws, { type:'system', text:`👋 Bienvenido${isAdmin?' <strong>(Administrador)</strong>':''}, <strong>${nickname}</strong>`, time:now() });
        broadcastAdmitted({ type:'system', text:`👋 <strong>${nickname}</strong> se unió al chat`, time:now() }, ws);
        pushUserList();
      } else {
        pending.set(ws, data);
        send(ws, { type:'waiting', text:'Solicitud enviada. Esperando que el administrador te admita…' });
        send(admin, { type:'pending_request', id, nickname, icon });
        pushUserList();
      }
      return;
    }

    /* CHAT MESSAGE */
    const user = admitted.get(ws);
    if (!user) return;

    if (m.type === 'message') {
      const text = san(String(m.text||'').trim()).slice(0,500);
      if (!text) return;
      let replyTo = null;
      if (m.replyTo) replyTo = {
        id:       String(m.replyTo.id||''),
        nickname: san(String(m.replyTo.nickname||'')),
        text:     san(String(m.replyTo.text||'').slice(0,120)),
      };
      const msg = { type:'message', id:String(++msgId), nickname:user.nickname, icon:user.icon, text, time:now(), replyTo };
      broadcastAdmitted(msg);
      send(ws, msg);
      return;
    }

    /* ADMIN ACTIONS */
    if (!user.isAdmin) return;

    if (m.type === 'admit') {
      for (const [pws, pu] of pending) { if (pu.id === m.id) { doAdmit(pws); break; } }
      pushUserList(); return;
    }
    if (m.type === 'reject') {
      for (const [pws, pu] of pending) {
        if (pu.id === m.id) {
          send(pws, { type:'rejected', text:'El administrador ha rechazado tu acceso.' });
          setTimeout(() => pws.close(), 500);
          pending.delete(pws); pushUserList(); break;
        }
      }
      return;
    }
    if (m.type === 'kick') {
      for (const [kws, ku] of admitted) {
        if (ku.id === m.id && !ku.isAdmin) {
          send(kws, { type:'kicked', text:'Has sido expulsado del chat por el administrador.' });
          setTimeout(() => kws.close(), 500);
          admitted.delete(kws);
          broadcastAdmitted({ type:'system', text:`🚫 <strong>${ku.nickname}</strong> fue expulsado por el administrador.`, time:now() });
          pushUserList(); break;
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    const u = admitted.get(ws);
    if (u) {
      admitted.delete(ws);
      broadcastAdmitted({ type:'system', text:`🚪 <strong>${u.nickname}</strong> salió del chat`, time:now() });
      pushUserList();
    }
    if (pending.has(ws)) { pending.delete(ws); pushUserList(); }
  });
});

server.listen(PORT, () => console.log(`✅ Servidor en puerto ${PORT}`));
