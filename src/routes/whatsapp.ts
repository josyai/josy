/**
 * WhatsApp Webhook Routes
 *
 * Handles incoming WhatsApp messages via Twilio.
 * This is the thin interaction surface for Phase 4.
 */

import { Router, Request, Response } from 'express';
import { handleMessage } from '../services/conversation';

const router = Router();

/**
 * Twilio webhook for incoming WhatsApp messages
 *
 * POST /webhooks/whatsapp
 *
 * Twilio sends:
 * - From: WhatsApp number (e.g., "whatsapp:+1234567890")
 * - Body: Message text
 *
 * We respond with TwiML to send a reply.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const from = req.body.From as string;
    const body = req.body.Body as string;

    // Extract phone number from WhatsApp format
    const phoneNumber = from.replace('whatsapp:', '');

    console.log(`[WhatsApp] From: ${phoneNumber}, Message: ${body}`);

    // Process the message
    const response = await handleMessage(phoneNumber, body);

    console.log(`[WhatsApp] Response: ${response.message}`);

    // Return TwiML response
    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(response.message)}</Message>
</Response>`);
  } catch (error) {
    console.error('[WhatsApp] Error:', error);

    res.type('text/xml');
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, something went wrong. Please try again!</Message>
</Response>`);
  }
});

/**
 * Twilio webhook status callback (optional)
 *
 * POST /webhooks/whatsapp/status
 */
router.post('/status', (req: Request, res: Response) => {
  const messageSid = req.body.MessageSid;
  const status = req.body.MessageStatus;
  console.log(`[WhatsApp Status] ${messageSid}: ${status}`);
  res.sendStatus(200);
});

/**
 * Health check / verification endpoint
 *
 * GET /webhooks/whatsapp
 */
router.get('/', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'josy-whatsapp',
    message: 'WhatsApp webhook is ready',
  });
});

/**
 * Escape XML special characters for TwiML response
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export { router as whatsappRoutes };
