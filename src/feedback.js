'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query, queryOne } = require('./db');
const {
  sendSMS, sendEmail,
  buildFeedbackSMS, buildFeedbackEmail,
  buildFollowUpSMS, buildFollowUpEmail,
  buildInternalAlertEmail,
} = require('./messaging');

const POSITIVE_THRESHOLD = parseInt(process.env.POSITIVE_THRESHOLD || '4', 10);

function buildFeedbackUrl(token) {
  return `${process.env.BASE_URL || 'http://localhost:3000'}/feedback/${token}`;
}

function buildUnsubscribeUrl(token) {
  return `${process.env.BASE_URL || 'http://localhost:3000'}/api/feedback/unsubscribe/${token}`;
}

function formatDate(val) {
  try {
    return new Date(val).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return String(val);
  }
}

async function createFeedbackRequest(visitId, clientId, scheduledFor = null) {
  const token = uuidv4();
  const scheduled = scheduledFor || new Date().toISOString();
  const row = await queryOne(
    `INSERT INTO feedback_requests (visit_id, client_id, token, scheduled_for)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [visitId, clientId, token, scheduled]
  );
  console.log(`[Feedback] Created request id=${row.id} token=${token}`);
  return { id: row.id, token };
}

async function sendFeedbackRequest(requestId) {
  const req = await queryOne(
    `SELECT fr.*, c.name AS client_name, c.phone, c.email, c.preferred_contact, c.opt_out,
            v.caregiver_name, v.visit_date
     FROM feedback_requests fr
     JOIN clients c ON c.id = fr.client_id
     JOIN visits  v ON v.id = fr.visit_id
     WHERE fr.id = $1`,
    [requestId]
  );

  if (!req) throw new Error(`Feedback request ${requestId} not found`);
  if (req.opt_out) {
    await query(`UPDATE feedback_requests SET status='opted_out' WHERE id=$1`, [requestId]);
    return;
  }
  if (req.status === 'responded') return;

  const feedbackUrl    = buildFeedbackUrl(req.token);
  const unsubscribeUrl = buildUnsubscribeUrl(req.token);
  const visitDate      = formatDate(req.visit_date);
  const params = { clientName: req.client_name, caregiverName: req.caregiver_name, visitDate, feedbackUrl, unsubscribeUrl };
  const errors = [];

  if ((req.preferred_contact === 'sms' || req.preferred_contact === 'both') && req.phone) {
    try { await sendSMS(req.phone, buildFeedbackSMS(params)); }
    catch (err) { console.error(`[Feedback] SMS failed for request ${requestId}:`, err.message); errors.push('sms'); }
  }

  if ((req.preferred_contact === 'email' || req.preferred_contact === 'both') && req.email) {
    try {
      await sendEmail(req.email, `How was your visit with ${req.caregiver_name}? — Arise Cares`, buildFeedbackEmail(params));
    } catch (err) { console.error(`[Feedback] Email failed for request ${requestId}:`, err.message); errors.push('email'); }
  }

  const newStatus = errors.length === 0 ? 'sent' : 'failed';
  await query(
    `UPDATE feedback_requests SET status=$1, sent_at=NOW(), channel=$2 WHERE id=$3`,
    [newStatus, req.preferred_contact, requestId]
  );

  if (newStatus === 'sent') await scheduleFollowUp(requestId, 48);
}

async function scheduleFollowUp(requestId, delayHours = 48) {
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();
  await query(
    `INSERT INTO follow_ups (feedback_request_id, scheduled_for) VALUES ($1, $2)`,
    [requestId, scheduledFor]
  );
  console.log(`[Feedback] Follow-up scheduled for request ${requestId} at ${scheduledFor}`);
}

async function processFeedbackResponse(token, rating, comment) {
  const req = await queryOne(
    `SELECT fr.*, c.name AS client_name, c.phone, c.email,
            v.caregiver_name, v.visit_date
     FROM feedback_requests fr
     JOIN clients c ON c.id = fr.client_id
     JOIN visits  v ON v.id = fr.visit_id
     WHERE fr.token = $1`,
    [token]
  );

  if (!req) throw new Error('Invalid or expired feedback token');

  if (req.status === 'responded') {
    const existing = await queryOne(
      `SELECT routed_to_google FROM feedback_responses WHERE feedback_request_id=$1 ORDER BY id DESC LIMIT 1`,
      [req.id]
    );
    return { googleReviewUrl: existing?.routed_to_google ? (process.env.GOOGLE_REVIEW_URL || null) : null };
  }

  const ratingNum       = parseInt(rating, 10);
  const isPositive      = ratingNum >= POSITIVE_THRESHOLD;
  const routedToGoogle  = isPositive;
  const internalFlagged = !isPositive;

  await query(
    `INSERT INTO feedback_responses
       (feedback_request_id, client_id, rating, comment, routed_to_google, internal_flagged)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.id, req.client_id, ratingNum, comment || null, routedToGoogle, internalFlagged]
  );

  await query(`UPDATE feedback_requests SET status='responded' WHERE id=$1`, [req.id]);
  await query(
    `UPDATE follow_ups SET status='cancelled' WHERE feedback_request_id=$1 AND status='pending'`,
    [req.id]
  );

  if (internalFlagged) {
    const internalEmail = process.env.INTERNAL_NOTIFY_EMAIL;
    const internalPhone = process.env.INTERNAL_NOTIFY_PHONE;
    if (internalEmail) {
      sendEmail(internalEmail, `⚠️ Low Rating Received — ${req.client_name} (${ratingNum}/5)`,
        buildInternalAlertEmail({ clientName: req.client_name, caregiverName: req.caregiver_name, visitDate: formatDate(req.visit_date), rating: ratingNum, comment })
      ).catch(err => console.error('[Feedback] Internal email alert failed:', err.message));
    }
    if (internalPhone) {
      sendSMS(internalPhone,
        `ARISE ALERT: ${req.client_name} gave a ${ratingNum}/5 rating for ${req.caregiver_name}'s visit. Comment: ${comment || 'none'}. Please follow up.`
      ).catch(err => console.error('[Feedback] Internal SMS alert failed:', err.message));
    }
  }

  return { googleReviewUrl: isPositive ? (process.env.GOOGLE_REVIEW_URL || null) : null };
}

async function sendFollowUp(followUpId) {
  const followUp = await queryOne(
    `SELECT fu.*, fr.token, fr.status AS req_status, fr.client_id,
            c.name AS client_name, c.phone, c.email, c.preferred_contact, c.opt_out
     FROM follow_ups fu
     JOIN feedback_requests fr ON fr.id = fu.feedback_request_id
     JOIN clients c ON c.id = fr.client_id
     WHERE fu.id = $1`,
    [followUpId]
  );

  if (!followUp) throw new Error(`Follow-up ${followUpId} not found`);
  if (followUp.req_status === 'responded' || followUp.opt_out) {
    await query(`UPDATE follow_ups SET status='cancelled' WHERE id=$1`, [followUpId]);
    return;
  }

  const feedbackUrl    = buildFeedbackUrl(followUp.token);
  const unsubscribeUrl = buildUnsubscribeUrl(followUp.token);
  const params = { clientName: followUp.client_name, feedbackUrl, unsubscribeUrl };
  const errors = [];

  if ((followUp.preferred_contact === 'sms' || followUp.preferred_contact === 'both') && followUp.phone) {
    try { await sendSMS(followUp.phone, buildFollowUpSMS(params)); }
    catch (err) { console.error(`[FollowUp] SMS failed for follow-up ${followUpId}:`, err.message); errors.push('sms'); }
  }

  if ((followUp.preferred_contact === 'email' || followUp.preferred_contact === 'both') && followUp.email) {
    try { await sendEmail(followUp.email, 'Following up on your recent visit — Arise Cares', buildFollowUpEmail(params)); }
    catch (err) { console.error(`[FollowUp] Email failed for follow-up ${followUpId}:`, err.message); errors.push('email'); }
  }

  const newStatus = errors.length === 0 ? 'sent' : 'failed';
  await query(`UPDATE follow_ups SET status=$1, sent_at=NOW() WHERE id=$2`, [newStatus, followUpId]);
}

async function getFeedbackInfo(token) {
  return queryOne(
    `SELECT fr.id, fr.status,
            c.name AS client_name,
            v.caregiver_name, v.visit_date
     FROM feedback_requests fr
     JOIN clients c ON c.id = fr.client_id
     JOIN visits  v ON v.id = fr.visit_id
     WHERE fr.token = $1`,
    [token]
  );
}

module.exports = {
  createFeedbackRequest,
  sendFeedbackRequest,
  scheduleFollowUp,
  processFeedbackResponse,
  sendFollowUp,
  getFeedbackInfo,
};
