import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import readline from 'readline';

const PORT = 3000;
const BOT_SECRET_TOKEN = process.env.BOT_SECRET_TOKEN;

const logger = pino({ level: 'silent' });

let sock;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let PHONE_NUMBER = '';
let pairingCodeRequested = false;

function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Enter your WhatsApp phone number (with country code, e.g., 212704969534): ', (answer) => {
      rl.close();
      resolve(answer.trim().replace(/[^0-9]/g, ''));
    });
  });
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: state,
    markOnlineOnConnect: false
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !pairingCodeRequested) {
      pairingCodeRequested = true;
      
      if (!PHONE_NUMBER) {
        console.log('\n' + '='.repeat(50));
        console.log('WhatsApp Authentication Required');
        console.log('='.repeat(50));
        PHONE_NUMBER = await askPhoneNumber();
        console.log('Phone number set to:', PHONE_NUMBER);
      }
      
      console.log('\nRequesting pairing code...');
      try {
        const code = await sock.requestPairingCode(PHONE_NUMBER);
        console.log('\n' + '='.repeat(50));
        console.log('PAIRING CODE:', code);
        console.log('='.repeat(50));
        console.log('Enter this code in WhatsApp:');
        console.log('1. Open WhatsApp on your phone');
        console.log('2. Go to Settings > Linked Devices');
        console.log('3. Tap "Link a Device"');
        console.log('4. Tap "Link with phone number instead"');
        console.log('5. Enter the pairing code above');
        console.log('='.repeat(50) + '\n');
      } catch (error) {
        console.error('Error requesting pairing code:', error.message);
        pairingCodeRequested = false;
      }
    }

    if (connection === 'close') {
      pairingCodeRequested = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      
      if (statusCode === DisconnectReason.loggedOut) {
        console.log('Logged out. Please delete auth_info folder and restart.');
        isConnected = false;
        reconnectAttempts = 0;
      } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        console.log(`Connection closed. Reconnecting in ${delay/1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        isConnected = false;
        setTimeout(() => connectToWhatsApp(), delay);
      } else {
        console.log('Max reconnection attempts reached. Please restart the bot.');
        isConnected = false;
      }
    } else if (connection === 'open') {
      console.log('Connected to WhatsApp successfully!');
      console.log('Your phone number:', PHONE_NUMBER);
      isConnected = true;
      reconnectAttempts = 0;
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

  if (!PHONE_NUMBER) {
    return res.status(503).json({ error: 'Phone number not configured' });
  }

  try {
    const jid = `${PHONE_NUMBER}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    console.log(`Message sent to ${PHONE_NUMBER}: ${message}`);
    res.json({ success: true, message: 'Message sent successfully', phone: PHONE_NUMBER });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    status: isConnected ? 'online' : 'offline',
    phone: PHONE_NUMBER || 'not set'
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
