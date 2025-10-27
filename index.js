import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';

// --- CONFIGURATION ---
const PORT = 3000;
const BOT_SECRET_TOKEN = process.env.BOT_SECRET_TOKEN;

// NEW: The number the bot is linked with (the SENDER)
const BOT_PHONE_NUMBER_RAW = process.env.BOT_PHONE_NUMBER;
const BOT_PHONE_NUMBER = BOT_PHONE_NUMBER_RAW ? BOT_PHONE_NUMBER_RAW.trim().replace(/[^0-9]/g, '') : '';

// NEW: The number that receives notifications (the RECEIVER/Admin)
const ADMIN_RECEIVER_PHONE_NUMBER_RAW = process.env.ADMIN_RECEIVER_PHONE_NUMBER;
const ADMIN_RECEIVER_PHONE_NUMBER = ADMIN_RECEIVER_PHONE_NUMBER_RAW ? ADMIN_RECEIVER_PHONE_NUMBER_RAW.trim().replace(/[^0-9]/g, '') : '';
// ---------------------

const logger = pino({ level: 'silent' });

let sock;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let pairingCodeRequested = false;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
  const { version } = await fetchLatestBaileysVersion();

  // Check the BOT's phone number, which is required for pairing
  if (!BOT_PHONE_NUMBER) {
    console.error('\n' + '='.repeat(50));
    console.error('ERROR: BOT_PHONE_NUMBER environment variable is not set or is invalid.');
    console.error('This is the number required for linking the bot.');
    console.error('='.repeat(50));
    process.exit(1);
  }
  
  // Check the ADMIN's phone number, which is required for sending
  if (!ADMIN_RECEIVER_PHONE_NUMBER) {
    console.warn('\n' + '='.repeat(50));
    console.warn('WARNING: ADMIN_RECEIVER_PHONE_NUMBER is not set.');
    console.warn('The bot will connect, but message sending via API will fail.');
    console.warn('='.repeat(50));
  }

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
      
      console.log('\nRequesting pairing code...');
      try {
        // Use BOT_PHONE_NUMBER for pairing
        const code = await sock.requestPairingCode(BOT_PHONE_NUMBER); 
        
        console.log('\n' + '='.repeat(50));
        console.log('PAIRING CODE:', code);
        console.log('='.repeat(50));
        console.log('Enter this code in WhatsApp for bot number:', BOT_PHONE_NUMBER);
        console.log('1. Open WhatsApp on your phone');
        // ... (linking instructions remain the same)
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
      console.log('Bot Phone Number (Sender):', BOT_PHONE_NUMBER);
      console.log('Admin Receiver Number (Recipient):', ADMIN_RECEIVER_PHONE_NUMBER || 'NOT SET');
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

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message must be a non-empty string' });
  }

  if (message.length > 4096) {
    return res.status(400).json({ error: 'Message too long (max 4096 characters)' });
  }

  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp bot is not connected' });
  }
  
  // Use ADMIN_RECEIVER_PHONE_NUMBER as the target
  const targetPhone = ADMIN_RECEIVER_PHONE_NUMBER; 

  if (!targetPhone) {
    return res.status(503).json({ error: 'Admin receiver phone number is not configured' });
  }

  try {
    const jid = `${targetPhone}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    console.log(`Message sent FROM ${BOT_PHONE_NUMBER} TO ${targetPhone}: ${message}`);
    res.json({ success: true, message: 'Message sent successfully', phone: targetPhone });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ 
    connected: isConnected,
    status: isConnected ? 'online' : 'offline',
    bot_sender_phone: BOT_PHONE_NUMBER || 'not set',
    admin_receiver_phone: ADMIN_RECEIVER_PHONE_NUMBER || 'not set'
  });
});

// --- INITIALIZATION ---

if (!BOT_SECRET_TOKEN) {
  console.error('ERROR: BOT_SECRET_TOKEN environment variable is not set');
  console.error('Please add BOT_SECRET_TOKEN to your environment secrets');
  process.exit(1);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on port ${PORT}`);
  connectToWhatsApp();
});
