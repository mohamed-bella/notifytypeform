import express from 'express';
import pino from 'pino';
import { fetch } from 'node-fetch'; // Standard for Node.js fetch implementation

// --- CONFIGURATION ---
const PORT = 8080; // Bridge runs on a different port than the main bot
// The URL of your main WhatsApp Bot API endpoint (e.g., /notify-admin)
const BOT_API_URL = process.env.BOT_API_URL || 'https://notifytypeform-production.up.railway.app/notify-admin'; 
// The secret token required by the main bot API
const BOT_SECRET_TOKEN = process.env.BOT_SECRET_TOKEN; 
// ---------------------

const logger = pino({ level: 'info' });
const app = express();
app.use(express.json()); // Middleware to parse incoming JSON payloads

/**
 * Parses the complex Typeform submission payload into a simple, readable notification string.
 * @param {object} payload - The raw submission data from Typeform.
 * @returns {string} The formatted message string.
 */
function formatTypeformSubmission(payload) {
    const submissionId = payload.event_id;
    const formTitle = payload.form_response?.definition?.title || 'Unknown Form';
    const submittedAt = new Date(payload.event_time).toLocaleString();
    
    let answersSummary = '';
    const answers = payload.form_response?.answers || [];

    // Extract key answers to create a concise summary
    for (const answer of answers) {
        const questionText = answer.field.title;
        let responseValue = '';

        if (answer.type === 'text' || answer.type === 'email' || answer.type === 'number') {
            responseValue = answer[answer.type];
        } else if (answer.type === 'choice') {
            responseValue = answer.choice.label;
        } else if (answer.type === 'choices') {
            responseValue = answer.choices.labels.join(', ');
        }
        
        // Add only non-empty or non-trivial responses to the summary
        if (responseValue) {
            answersSummary += `\n- ${questionText}: ${responseValue}`;
        }
    }

    const message = `
🔔 New Typeform Submission Received! 🔔

Form: ${formTitle}
Time: ${submittedAt}

--- Details ---${answersSummary}
-----------------
Submission ID: ${submissionId.substring(0, 8)}...
    `.trim();

    return message;
}

/**
 * Endpoint for Typeform Webhooks to hit.
 * This is the only URL you need to configure in the Typeform Webhook settings.
 */
app.post('/typeform-listener', async (req, res) => {
    logger.info('Received new request from Typeform webhook.');
    
    if (!req.body || !req.body.event_type) {
        logger.warn('Received invalid payload (not a standard Typeform event).');
        return res.status(400).send('Invalid Typeform payload.');
    }

    if (req.body.event_type !== 'form_response') {
         // Optionally handle other events, but we focus on submissions
        return res.status(200).send('Event received, but not a form response. Ignoring.');
    }

    // 1. Process and format the message
    const notificationMessage = formatTypeformSubmission(req.body);

    if (!BOT_SECRET_TOKEN) {
        logger.error('BOT_SECRET_TOKEN is missing. Cannot send notification.');
        return res.status(500).send('Server configuration error.');
    }

    try {
        // 2. Securely forward the formatted message to the main bot API
        const botResponse = await fetch(BOT_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BOT_SECRET_TOKEN}` 
            },
            body: JSON.stringify({
                message: notificationMessage
            })
        });

        const botData = await botResponse.json();

        if (botResponse.ok) {
            logger.info('Notification successfully forwarded and accepted by the main bot.', { phone: botData.phone });
            // 3. Respond with 200 OK to Typeform (important for Typeform to know it succeeded)
            res.status(200).json({ status: 'success', forwarded_to: BOT_API_URL });
        } else {
            logger.error('Main bot API failed to process the notification.', { status: botResponse.status, error: botData.error });
            // If the main bot fails (e.g., it's disconnected), we still respond 200 to Typeform 
            // to prevent repeated retries, but we log the error internally.
            res.status(502).json({ status: 'error_forwarding', details: botData });
        }

    } catch (error) {
        logger.error('Failed to communicate with the main bot API.', error);
        res.status(500).json({ status: 'internal_error', details: error.message });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'Bridge running', 
        target_bot_api: BOT_API_URL, 
        auth_status: BOT_SECRET_TOKEN ? 'Token set' : 'Token missing'
    });
});


if (!BOT_SECRET_TOKEN) {
    logger.error('CRITICAL: BOT_SECRET_TOKEN environment variable is not set. The bridge cannot authenticate the call to the main bot.');
    // Do not exit, allow service to start for debugging, but calls will fail.
}

app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Webhook Bridge Server running on port ${PORT}.`);
    logger.info(`Typeform Webhook URL to use: YOUR_BRIDGE_URL:${PORT}/typeform-listener`);
    logger.info(`Targeting Main Bot API at: ${BOT_API_URL}`);
});
