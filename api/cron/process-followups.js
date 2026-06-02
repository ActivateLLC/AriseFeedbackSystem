'use strict';

const { query } = require('../../src/db');
const { sendFollowUp } = require('../../src/feedback');

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const pending = await query(
    `SELECT fu.id FROM follow_ups fu
     JOIN feedback_requests fr ON fr.id = fu.feedback_request_id
     WHERE fu.status = 'pending'
       AND fu.scheduled_for <= NOW()
       AND fr.status NOT IN ('responded', 'opted_out')
     ORDER BY fu.scheduled_for ASC LIMIT 50`
  );

  const results = [];
  for (const row of pending) {
    try {
      await sendFollowUp(row.id);
      results.push({ id: row.id, ok: true });
    } catch (err) {
      console.error(`[Cron] Error sending follow-up ${row.id}:`, err.message);
      results.push({ id: row.id, ok: false, error: err.message });
    }
  }

  return res.json({ processed: results.length, results });
};
