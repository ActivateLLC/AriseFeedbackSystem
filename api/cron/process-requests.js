'use strict';

const { query } = require('../../src/db');
const { sendFeedbackRequest } = require('../../src/feedback');

module.exports = async (req, res) => {
  // Verify this is called by Vercel Cron
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pending = await query(
    `SELECT id FROM feedback_requests
     WHERE status = 'pending' AND scheduled_for <= NOW()
     ORDER BY scheduled_for ASC LIMIT 50`
  );

  const results = [];
  for (const row of pending) {
    try {
      await sendFeedbackRequest(row.id);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      console.error(`[Cron] Error sending request ${row.id}:`, err.message);
      results.push({ id: row.id, ok: false, error: err.message });
    }
  }

  return res.json({ processed: results.length, results });
};
