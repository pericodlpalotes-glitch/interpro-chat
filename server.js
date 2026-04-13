const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// HTTP server — sirve el index.html
const server = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// WebSocket server sobre el mismo puerto HTTP
const wss = new WebSocket.Server({ server });

// Guarda usuarios conectados: ws -> { nickname, icon }
const users = new Map();

wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Registro de usuario
    if (msg.type === 'join') {
      users.set(ws, { nickname: msg.nickname, icon: msg.icon });
      broadcast({
        type: 'system',
        text: `👋 <strong>${msg.nickname}</strong> se unió al chat`,
        time: now(),
        count: wss.clients.size,
      });
      return;
    }

    // Mensaje de chat
    if (msg.type === 'message') {
      const user = users.get(ws) || { nickname: 'Anónimo', icon: '' };
      broadcast({
        type: 'message',
        nickname: user.nickname,
        icon: user.icon,
        text: sanitize(msg.text),
        time: now(),
      });
    }
  });

  ws.on('close', () => {
    const user = users.get(ws);
    users.delete(ws);
    if (user) {
      broadcast({
        type: 'system',
        text: `🚪 <strong>${user.nickname}</strong> salió del chat`,
        time: now(),
        count: wss.clients.size,
      });
    }
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function now() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function sanitize(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

server.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));
