import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const ADMIN_NUMBER = '2126XXXXXXXX@s.whatsapp.net';
const PORT = 3000;

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

app.post('/notify-admin', async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Message field is required' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on port ${PORT}`);
  connectToWhatsApp();
});
