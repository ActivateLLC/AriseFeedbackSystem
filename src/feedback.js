'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./db');
const {
  sendSMS,
  sendEmail,
  buildFeedbackSMS,
  buildFeedbackEmail,
  buildFollowUpSMS,
  buildFollowUpEmail,
  buildInternalAlertEmail,
} = require('./messaging');

const POSITIVE_THRESHOLD = parseInt(process.env.POSITIVE_THRESHOLD || '4', 10);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFeedbackUrl(token) {
  return `${process.env.BASE_URL || 'http://localhost:3000'}/feedback/${token}`;
}

function buildUnsubscribeUrl(token) {
  return `${process.env.BASE_URL || 'http://localhost:3000'}/api/feedback/unsubscribe/${token}`;
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return isoString;
  }
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Create a feedback_request record for a given visit + client.
 * Returns the new request id and token.
 */
function createFeedbackRequest(visitId, clientId, scheduledFor = null) {
  const db = getDb();
  const token = uuidv4();
  const scheduled = scheduledFor || new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO feedback_requests (visit_id, client_id, token, scheduled_for)
    VALUES (@visitId, @clientId, @token, @scheduledFor)
  `);
  const result = stmt.run({ visitId, clientId, token, scheduledFor: scheduled });
  console.log(`[Feedback] Created request id=${result.lastInsertRowid} token=${token}`);
  return { id: result.lastInsertRowid, token };
}

/**
 * Dispatch the feedback request (SMS / email / both) based on the client's preference.
 * Updates status in DB.
 */
async function sendFeedbackRequest(requestId) {
  const db = getDb();

  const req = db.prepare(`
    SELECT fr.*, c.name AS client_name, c.phone, c.email, c.preferred_contact, c.opt_out,
           v.caregiver_name, v.visit_date
    FROM feedback_requests fr
    JOIN clients c  ON c.id = fr.client_id
    JOIN visits  v  ON v.id = fr.visit_id
    WHERE fr.id = ?
  `).get(requestId);

  if (!req) throw new Error(`Feedback request ${requestId} not found`);
  if (req.opt_out) {
    db.prepare(`UPDATE feedback_requests SET status='opted_out' WHERE id=?`).run(requestId);
    console.log(`[Feedback] Client opted out, skipping request ${requestId}`);
    return;
  }
  if (req.status === 'responded') {
    console.log(`[Feedback] Request ${requestId} already responded, skipping`);
    return;
  }

  const feedbackUrl    = buildFeedbackUrl(req.token);
  const unsubscribeUrl = buildUnsubscribeUrl(req.token);
  const visitDate      = formatDate(req.visit_date);
  const params         = {
    clientName:    req.client_name,
    caregiverName: req.caregiver_name,
    visitDate,
    feedbackUrl,
    unsubscribeUrl,
  };

  const errors = [];

  if ((req.preferred_contact === 'sms' || req.preferred_contact === 'both') && req.phone) {
    try {
      await sendSMS(req.phone, buildFeedbackSMS(params));
    } catch (err) {
      console.error(`[Feedback] SMS failed for request ${requestId}:`, err.message);
      errors.push('sms');
    }
  }

  if ((req.preferred_contact === 'email' || req.preferred_contact === 'both') && req.email) {
    try {
      await sendEmail(
        req.email,
        `How was your visit with ${req.caregiver_name}? — Arise Cares`,
        buildFeedbackEmail(params)
      );
    } catch (err) {
      console.error(`[Feedback] Email failed for request ${requestId}:`, err.message);
      errors.push('email');
    }
  }

  const newStatus = errors.length === 0 ? 'sent' : 'failed';
  db.prepare(`
    UPDATE feedback_requests
    SET status=@status, sent_at=datetime('now'), channel=@channel
    WHERE id=@id
  `).run({ status: newStatus, channel: req.preferred_contact, id: requestId });

  if (newStatus === 'sent') {
    // Schedule follow-up 48 hours later
    scheduleFollowUp(requestId, 48);
  }
}

/**
 * Schedule a follow-up for a request (if no response by then).
 * @param {number} requestId
 * @param {number} delayHours
 */
function scheduleFollowUp(requestId, delayHours = 48) {
  const db = getDb();
  const scheduledFor = new Date(Date.now() + delayHours * 60 * 60 * 1000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO follow_ups (feedback_request_id, scheduled_for)
    VALUES (?, ?)
  `);
  stmt.run(requestId, scheduledFor);
  console.log(`[Feedback] Follow-up scheduled for request ${requestId} at ${scheduledFor}`);
}

/**
 * Process a submitted feedback response.
 * Saves to DB, routes to Google (if positive) or flags internally.
 * Returns { googleReviewUrl } or { googleReviewUrl: null }.
 */
async function processFeedbackResponse(token, rating, comment) {
  const db = getDb();

  const req = db.prepare(`
    SELECT fr.*, c.name AS client_name, c.phone, c.email,
           v.caregiver_name, v.visit_date
    FROM feedback_requests fr
    JOIN clients c ON c.id = fr.client_id
    JOIN visits  v ON v.id = fr.visit_id
    WHERE fr.token = ?
  `).get(token);

  if (!req) throw new Error('Invalid or expired feedback token');
  if (req.status === 'responded') {
    // Idempotent — return existing routing decision
    const existing = db.prepare(
      `SELECT routed_to_google FROM feedback_responses WHERE feedback_request_id=? ORDER BY id DESC LIMIT 1`
    ).get(req.id);
    return {
      googleReviewUrl: existing?.routed_to_google ? (process.env.GOOGLE_REVIEW_URL || null) : null,
    };
  }

  const ratingNum       = parseInt(rating, 10);
  const isPositive      = ratingNum >= POSITIVE_THRESHOLD;
  const routedToGoogle  = isPositive ? 1 : 0;
  const internalFlagged = isPositive ? 0 : 1;

  // Save response
  db.prepare(`
    INSERT INTO feedback_responses
      (feedback_request_id, client_id, rating, comment, routed_to_google, internal_flagged)
    VALUES (@reqId, @clientId, @rating, @comment, @routedToGoogle, @internalFlagged)
  `).run({
    reqId: req.id,
    clientId: req.client_id,
    rating: ratingNum,
    comment: comment || null,
    routedToGoogle,
    internalFlagged,
  });

  // Mark request as responded & cancel any pending follow-ups
  db.prepare(`UPDATE feedback_requests SET status='responded' WHERE id=?`).run(req.id);
  db.prepare(`UPDATE follow_ups SET status='cancelled' WHERE feedback_request_id=? AND status='pending'`).run(req.id);

  // Internal notification for low ratings
  if (internalFlagged) {
    const internalEmail = process.env.INTERNAL_NOTIFY_EMAIL;
    const internalPhone = process.env.INTERNAL_NOTIFY_PHONE;

    if (internalEmail) {
      sendEmail(
        internalEmail,
        `⚠️ Low Rating Received — ${req.client_name} (${ratingNum}/5)`,
        buildInternalAlertEmail({
          clientName:    req.client_name,
          caregiverName: req.caregiver_name,
          visitDate:     formatDate(req.visit_date),
          rating:        ratingNum,
          comment,
        })
      ).catch(err => console.error('[Feedback] Internal email alert failed:', err.message));
    }

    if (internalPhone) {
      const smsBody =
        `ARISE ALERT: ${req.client_name} gave a ${ratingNum}/5 rating for ${req.caregiver_name}'s visit. ` +
        `Comment: ${comment || 'none'}. Please follow up.`;
      sendSMS(internalPhone, smsBody)
        .catch(err => console.error('[Feedback] Internal SMS alert failed:', err.message));
    }
  }

  return {
    googleReviewUrl: isPositive ? (process.env.GOOGLE_REVIEW_URL || null) : null,
  };
}

/**
 * Send a follow-up message for a given follow_up row id.
 */
async function sendFollowUp(followUpId) {
  const db = getDb();

  const followUp = db.prepare(`
    SELECT fu.*, fr.token, fr.status AS req_status, fr.client_id,
           c.name AS client_name, c.phone, c.email, c.preferred_contact, c.opt_out
    FROM follow_ups fu
    JOIN feedback_requests fr ON fr.id = fu.feedback_request_id
    JOIN clients c ON c.id = fr.client_id
    WHERE fu.id = ?
  `).get(followUpId);

  if (!followUp) throw new Error(`Follow-up ${followUpId} not found`);

  // Cancel if already responded or opted out
  if (followUp.req_status === 'responded' || followUp.opt_out) {
    db.prepare(`UPDATE follow_ups SET status='cancelled' WHERE id=?`).run(followUpId);
    return;
  }

  const feedbackUrl    = buildFeedbackUrl(followUp.token);
  const unsubscribeUrl = buildUnsubscribeUrl(followUp.token);
  const params         = { clientName: followUp.client_name, feedbackUrl, unsubscribeUrl };
  const errors         = [];

  if ((followUp.preferred_contact === 'sms' || followUp.preferred_contact === 'both') && followUp.phone) {
    try {
      await sendSMS(followUp.phone, buildFollowUpSMS(params));
    } catch (err) {
      console.error(`[FollowUp] SMS failed for follow-up ${followUpId}:`, err.message);
      errors.push('sms');
    }
  }

  if ((followUp.preferred_contact === 'email' || followUp.preferred_contact === 'both') && followUp.email) {
    try {
      await sendEmail(followUp.email, 'Following up on your recent visit — Arise Cares', buildFollowUpEmail(params));
    } catch (err) {
      console.error(`[FollowUp] Email failed for follow-up ${followUpId}:`, err.message);
      errors.push('email');
    }
  }

  const newStatus = errors.length === 0 ? 'sent' : 'failed';
  db.prepare(`
    UPDATE follow_ups SET status=@status, sent_at=datetime('now') WHERE id=@id
  `).run({ status: newStatus, id: followUpId });
}

/**
 * Get feedback request info by token (used by the frontend form).
 */
function getFeedbackInfo(token) {
  const db = getDb();
  return db.prepare(`
    SELECT fr.id, fr.status,
           c.name AS client_name,
           v.caregiver_name, v.visit_date
    FROM feedback_requests fr
    JOIN clients c ON c.id = fr.client_id
    JOIN visits  v ON v.id = fr.visit_id
    WHERE fr.token = ?
  `).get(token);
}

module.exports = {
  createFeedbackRequest,
  sendFeedbackRequest,
  scheduleFollowUp,
  processFeedbackResponse,
  sendFollowUp,
  getFeedbackInfo,
};
