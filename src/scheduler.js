'use strict';

require('dotenv').config();
const cron = require('node-cron');
const { getDb } = require('./db');
const { sendFeedbackRequest, sendFollowUp } = require('./feedback');

/**
 * Process any feedback_requests that are:
 * - status = 'pending'
 * - scheduled_for <= now
 */
async function processPendingRequests() {
  const db = getDb();
  const pending = db.prepare(`
    SELECT id FROM feedback_requests
    WHERE status = 'pending'
      AND scheduled_for <= datetime('now')
    ORDER BY scheduled_for ASC
    LIMIT 50
  `).all();

  if (pending.length === 0) return;
  console.log(`[Scheduler] Processing ${pending.length} pending feedback request(s)...`);

  for (const row of pending) {
    try {
      await sendFeedbackRequest(row.id);
    } catch (err) {
      console.error(`[Scheduler] Error sending request ${row.id}:`, err.message);
    }
  }
}

/**
 * Process any follow_ups that are:
 * - status = 'pending'
 * - scheduled_for <= now
 * - parent request still not responded
 */
async function processPendingFollowUps() {
  const db = getDb();
  const pending = db.prepare(`
    SELECT fu.id
    FROM follow_ups fu
    JOIN feedback_requests fr ON fr.id = fu.feedback_request_id
    WHERE fu.status = 'pending'
      AND fu.scheduled_for <= datetime('now')
      AND fr.status NOT IN ('responded', 'opted_out')
    ORDER BY fu.scheduled_for ASC
    LIMIT 50
  `).all();

  if (pending.length === 0) return;
  console.log(`[Scheduler] Processing ${pending.length} pending follow-up(s)...`);

  for (const row of pending) {
    try {
      await sendFollowUp(row.id);
    } catch (err) {
      console.error(`[Scheduler] Error sending follow-up ${row.id}:`, err.message);
    }
  }
}

/**
 * Start all cron jobs.
 */
function startScheduler() {
  // Check for pending feedback requests every hour, on the hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Hourly check for pending feedback requests...');
    await processPendingRequests().catch(err =>
      console.error('[Scheduler] processPendingRequests error:', err.message)
    );
  });

  // Check for pending follow-ups every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Scheduler] 30-min check for pending follow-ups...');
    await processPendingFollowUps().catch(err =>
      console.error('[Scheduler] processPendingFollowUps error:', err.message)
    );
  });

  console.log('[Scheduler] Cron jobs started (requests: hourly | follow-ups: every 30 min)');
}

module.exports = { startScheduler, processPendingRequests, processPendingFollowUps };
