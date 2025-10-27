import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';

// --- CONFIGURATION ---
const PORT = 3000;
// The BOT_SECRET_TOKEN has been removed, making the API endpoint publicly accessible.

// HARDCODED VALUES 
// The number the bot is linked with (the SENDER)
const BOT_PHONE_NUMBER = '212706062033'; 

// The number that receives notifications (the RECEIVER/Admin)
const ADMIN_RECEIVER_PHONE_NUMBER = '212704969534';
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
      console.log('Bot Phone Number (Sender):', BOT_PHONE_NUMBER);
      console.log('Admin Receiver Number (Recipient):', ADMIN_RECEIVER_PHONE_NUMBER);
      isConnected = true;
      reconnectAttempts = 0;
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

const app = express();
app.use(express.json());

// The authentication middleware function is removed.
app.post('/notify-admin', async (req, res) => {
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
    bot_sender_phone: BOT_PHONE_NUMBER,
    admin_receiver_phone: ADMIN_RECEIVER_PHONE_NUMBER
  });
});

// --- INITIALIZATION ---
// The BOT_SECRET_TOKEN environment check is removed.

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Express server running on port ${PORT}`);
  connectToWhatsApp();
});
