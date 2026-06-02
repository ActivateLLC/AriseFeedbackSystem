'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');

// ─── Twilio client (lazy-init so missing creds don't crash startup) ───────────
let twilioClient = null;
function getTwilio() {
  if (!twilioClient) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
    }
    twilioClient = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// ─── Nodemailer transport (lazy-init) ─────────────────────────────────────────
let mailer = null;
function getMailer() {
  if (!mailer) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP credentials not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');
    }
    mailer = nodemailer.createTransport({
      host: SMTP_HOST,
      port: parseInt(SMTP_PORT || '587', 10),
      secure: parseInt(SMTP_PORT || '587', 10) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return mailer;
}

// ─── Core send functions ──────────────────────────────────────────────────────

/**
 * Send an SMS via Twilio.
 * @param {string} to   E.164 phone number
 * @param {string} body Message text
 */
async function sendSMS(to, body) {
  if (process.env.DEMO_MODE === 'true') {
    console.log(`[DEMO SMS] To: ${to}\n${body}`);
    return { sid: 'DEMO_SID_' + Date.now() };
  }
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER not set');

  const client = getTwilio();
  const msg = await client.messages.create({ to, from, body });
  console.log(`[SMS] Sent to ${to} | sid=${msg.sid}`);
  return msg;
}

/**
 * Send an email via Nodemailer.
 * @param {string} to       Recipient address
 * @param {string} subject  Email subject
 * @param {string} htmlBody HTML email body
 */
async function sendEmail(to, subject, htmlBody) {
  if (process.env.DEMO_MODE === 'true') {
    console.log(`[DEMO EMAIL] To: ${to} | Subject: ${subject}`);
    return { messageId: 'demo-' + Date.now() };
  }
  const fromName    = process.env.EMAIL_FROM_NAME    || 'Arise Cares Team';
  const fromAddress = process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER;
  const transport   = getMailer();

  const info = await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    html: htmlBody,
  });
  console.log(`[Email] Sent to ${to} | messageId=${info.messageId}`);
  return info;
}

// ─── Feedback-specific helpers ────────────────────────────────────────────────

/**
 * Build the feedback request SMS body.
 */
function buildFeedbackSMS({ clientName, caregiverName, visitDate, feedbackUrl, unsubscribeUrl }) {
  return (
    `Hi ${clientName}! 💙 Arise Cares here. How was your visit with ${caregiverName} on ${visitDate}?\n\n` +
    `Share your feedback (just 1 min): ${feedbackUrl}\n\n` +
    `Reply STOP or opt out: ${unsubscribeUrl}`
  );
}

/**
 * Build the feedback request email HTML body.
 */
function buildFeedbackEmail({ clientName, caregiverName, visitDate, feedbackUrl, unsubscribeUrl }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2d9cdb,#27ae60);padding:32px 32px 24px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Arise Cares</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Home Care Feedback</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1a1a2e;line-height:1.6;">Hi <strong>${clientName}</strong>,</p>
            <p style="margin:0 0 16px;font-size:16px;color:#444;line-height:1.7;">
              We hope you're doing well! We'd love to hear how your visit with
              <strong>${caregiverName}</strong> on <strong>${visitDate}</strong> went.
            </p>
            <p style="margin:0 0 28px;font-size:16px;color:#444;line-height:1.7;">
              Your feedback helps us continue providing the best care possible.
              It only takes about a minute!
            </p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${feedbackUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#2d9cdb,#27ae60);color:#fff;
                        text-decoration:none;padding:16px 40px;border-radius:50px;font-size:17px;
                        font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 14px rgba(45,156,219,0.4);">
                Share My Feedback
              </a>
            </div>
            <p style="margin:0;font-size:14px;color:#888;text-align:center;line-height:1.6;">
              With care,<br>
              <strong>The Arise Cares Team</strong>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f8f8;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              You're receiving this because you're a valued Arise Cares client.<br>
              <a href="${unsubscribeUrl}" style="color:#2d9cdb;text-decoration:none;">Unsubscribe from feedback requests</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build the follow-up SMS (sent 48 h after initial if no response).
 */
function buildFollowUpSMS({ clientName, feedbackUrl, unsubscribeUrl }) {
  return (
    `Hi ${clientName}, this is Arise Cares following up. ` +
    `We'd still love to hear about your recent visit: ${feedbackUrl}\n\n` +
    `Opt out: ${unsubscribeUrl}`
  );
}

/**
 * Build the follow-up email HTML body.
 */
function buildFollowUpEmail({ clientName, feedbackUrl, unsubscribeUrl }) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f7f4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#2d9cdb,#27ae60);padding:32px 32px 24px;text-align:center;">
            <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Arise Cares</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 16px;font-size:17px;color:#1a1a2e;">Hi <strong>${clientName}</strong>,</p>
            <p style="margin:0 0 16px;font-size:16px;color:#444;line-height:1.7;">
              We wanted to follow up — we'd really value hearing about your recent care experience.
              Your feedback helps us serve you and others better.
            </p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${feedbackUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#2d9cdb,#27ae60);color:#fff;
                        text-decoration:none;padding:16px 40px;border-radius:50px;font-size:17px;
                        font-weight:700;box-shadow:0 4px 14px rgba(45,156,219,0.4);">
                Share My Feedback
              </a>
            </div>
            <p style="margin:0;font-size:14px;color:#888;text-align:center;">
              With care,<br><strong>The Arise Cares Team</strong>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f8f8;padding:16px 32px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;font-size:12px;color:#aaa;">
              <a href="${unsubscribeUrl}" style="color:#2d9cdb;text-decoration:none;">Unsubscribe</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build internal alert email for low-rating responses.
 */
function buildInternalAlertEmail({ clientName, caregiverName, visitDate, rating, comment }) {
  const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;padding:24px;background:#fff3cd;">
  <h2 style="color:#856404;">⚠️ Low-Rating Feedback Received</h2>
  <table style="border-collapse:collapse;width:100%;max-width:500px;">
    <tr><td style="padding:8px;font-weight:bold;width:140px;">Client</td><td style="padding:8px;">${clientName}</td></tr>
    <tr style="background:#fff8e1;"><td style="padding:8px;font-weight:bold;">Caregiver</td><td style="padding:8px;">${caregiverName}</td></tr>
    <tr><td style="padding:8px;font-weight:bold;">Visit Date</td><td style="padding:8px;">${visitDate}</td></tr>
    <tr style="background:#fff8e1;"><td style="padding:8px;font-weight:bold;">Rating</td><td style="padding:8px;font-size:20px;">${stars} (${rating}/5)</td></tr>
    <tr><td style="padding:8px;font-weight:bold;">Comment</td><td style="padding:8px;">${comment || '<em>No comment provided</em>'}</td></tr>
  </table>
  <p style="color:#856404;margin-top:16px;">Please follow up with this client promptly.</p>
</body>
</html>`;
}

module.exports = {
  sendSMS,
  sendEmail,
  buildFeedbackSMS,
  buildFeedbackEmail,
  buildFollowUpSMS,
  buildFollowUpEmail,
  buildInternalAlertEmail,
};
