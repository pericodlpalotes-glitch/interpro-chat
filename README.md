# 💬 InterPRO Team Chat

Chat colaborativo en tiempo real con WebSockets.

## Estructura
```
interpro-chat/
├── server.js          ← Servidor Node.js + WebSocket
├── package.json
└── public/
    └── index.html     ← Cliente web (servido automáticamente)
```

---

## 🚀 Despliegue gratuito en Render.com (recomendado)

### Paso 1 — Subir a GitHub
1. Crea un repositorio en [github.com](https://github.com) (puede ser privado).
2. Sube estos archivos:
   ```bash
   git init
   git add .
   git commit -m "InterPRO Chat v1"
   git remote add origin https://github.com/TU_USUARIO/interpro-chat.git
   git push -u origin main
   ```

### Paso 2 — Crear servicio en Render
1. Ve a [render.com](https://render.com) → **New +** → **Web Service**
2. Conecta tu cuenta de GitHub y selecciona el repositorio.
3. Configura:
   | Campo | Valor |
   |-------|-------|
   | **Environment** | `Node` |
   | **Build Command** | `npm install` |
   | **Start Command** | `npm start` |
   | **Plan** | `Free` |
4. Haz clic en **Create Web Service**.

### Paso 3 — ¡Listo!
Render te dará una URL tipo `https://interpro-chat.onrender.com`.  
Compártela con tu equipo — el chat funciona en tiempo real entre todos los usuarios.

> ⚠️ En el plan gratuito de Render el servidor "duerme" tras 15 min de inactividad.
> El primer mensaje tardará ~30 s en despertar. Para evitarlo, considera el plan Starter ($7/mes).

---

## 🔌 Alternativa: Glitch.com (más fácil, sin Git)

1. Ve a [glitch.com](https://glitch.com) → **New Project** → **Import from GitHub** (o crea un proyecto vacío).
2. Sube / pega los archivos directamente en el editor web.
3. Glitch te da una URL pública instantáneamente.
4. El servidor permanece activo mientras lo uses.

---

## Desarrollo local
```bash
npm install
npm start
# Abre http://localhost:3000
```
