# WhatsApp Bot - Admin Notification System

## Overview
A production-ready WhatsApp bot built with Baileys and Express.js that enables sending notifications to an admin WhatsApp number via HTTP requests. The bot authenticates using QR code (like WhatsApp Web), maintains persistent sessions, and automatically reconnects if disconnected.

**Current State:** ✅ Fully functional
- Bot running on port 3000
- QR code authentication ready
- Session persistence configured
- Auto-reconnection enabled

## Recent Changes
- **2025-10-27**: Initial implementation
  - Created WhatsApp bot with Baileys library
  - Set up Express server with /notify-admin endpoint
  - Configured ESM module support
  - Added session persistence with useMultiFileAuthState
  - Implemented automatic reconnection logic
  - Added .gitignore for node_modules and auth_info

## Project Architecture

### File Structure
```
.
├── index.js           # Main bot application
├── package.json       # Project configuration with ESM
├── .gitignore         # Ignore auth_info and node_modules
└── auth_info/         # WhatsApp session data (auto-generated)
```

### Key Components

#### WhatsApp Bot (`index.js`)
- **Authentication**: QR code displayed in console for WhatsApp Web-style login
- **Session Management**: Uses `useMultiFileAuthState` to persist sessions in `./auth_info`
- **Auto-reconnect**: Automatically reconnects on disconnection (except when logged out)
- **Connection Logging**: Logs connect, reconnect, and logout events

#### Express API
- **POST /notify-admin**: Send messages to admin WhatsApp number
  - Request body: `{ "message": "your text here" }`
  - Returns success/error response
- **GET /status**: Check bot connection status
- **Port**: 3000 (bound to 0.0.0.0)

### Admin Configuration
Admin WhatsApp number is configured in `index.js`:
```javascript
const ADMIN_NUMBER = '2126XXXXXXXX@s.whatsapp.net';
```

## Usage

### First Time Setup
1. Run the bot (it starts automatically)
2. Scan the QR code in the console with WhatsApp mobile app
3. Bot will save session and stay connected

### Sending Notifications
```bash
curl -X POST http://localhost:3000/notify-admin \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from the bot!"}'
```

### Check Bot Status
```bash
curl http://localhost:3000/status
```

## Technical Details

### Dependencies
- `@whiskeysockets/baileys`: WhatsApp Web API library
- `express`: HTTP server framework
- `pino`: Logging (required by Baileys, set to silent)
- `qrcode-terminal`: QR code display in terminal

### Session Persistence
Sessions are stored in the `./auth_info` folder. To reset authentication:
1. Stop the bot
2. Delete the `auth_info` folder
3. Restart and scan new QR code

### Connection States
- **Open**: Successfully connected to WhatsApp
- **Close**: Disconnected (will auto-reconnect unless logged out)
- **Logged Out**: Manual logout - requires QR scan to reconnect

## Notes
- The bot uses ESM syntax (type: "module" in package.json)
- Logger is set to silent to reduce console noise
- Port 3000 is required for Replit environment
- Session data in auth_info folder is git-ignored for security
