import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const ADMIN_NUMBER = '2126704969534@s.whatsapp.net';
const PORT = 3000;
const BOT_SECRET_TOKEN = process.env.BOT_SECRET_TOKEN;

const logger = pino({ level: 'silent' });

let sock;
let isConnected = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: state,
    qrTimeout: 60000
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('Scan QR code to authenticate:');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) {
        console.log('Logged out. Please delete auth_info folder and restart.');
        isConnected = false;
      } else {
        console.log('Connection closed. Reconnecting...', lastDisconnect?.error);
        isConnected = false;
        if (shouldReconnect) {
          await connectToWhatsApp();
        }
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp successfully!');
      isConnected = true;
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

const app = express();
app.use(express.json());

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  if (token !== BOT_SECRET_TOKEN) {
    return res.status(403).json({ error: 'Invalid authorization token' });
  }

  next();
}

app.post('/notify-admin', authenticateToken, async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message field is required' });
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message must be a non-empty string' });
  }

  if (message.length > 4096) {
    return res.status(400).json({ error: 'Message too long (max 4096 characters)' });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp bot is not connected' });
  }

  try {
    await sock.sendMessage(ADMIN_NUMBER, { text: message });
    console.log(`Message sent to admin: ${message}`);
    res.json({ success: true, message: 'Message sent to admin' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    status: isConnected ? 'online' : 'offline'
  });
});

if (!BOT_SECRET_TOKEN) {
  console.error('ERROR: BOT_SECRET_TOKEN environment variable is not set');
  console.error('Please add BOT_SECRET_TOKEN to your environment secrets');
  process.exit(1);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on port ${PORT}`);
  connectToWhatsApp();
});
