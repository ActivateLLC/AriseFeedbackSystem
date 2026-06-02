'use strict';

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');

router.get('/stats', async (req, res) => {
  try {
    const [reqRow, respRow, avgRow, googleRow, flagRow, distRows, trendRows] = await Promise.all([
      queryOne(`SELECT COUNT(*)::int AS count FROM feedback_requests`),
      queryOne(`SELECT COUNT(*)::int AS count FROM feedback_responses`),
      queryOne(`SELECT ROUND(AVG(rating)::numeric, 2) AS avg FROM feedback_responses`),
      queryOne(`SELECT COUNT(*)::int AS count FROM feedback_responses WHERE routed_to_google = true`),
      queryOne(`SELECT COUNT(*)::int AS count FROM feedback_responses WHERE internal_flagged = true`),
      query(`SELECT rating, COUNT(*)::int AS count FROM feedback_responses GROUP BY rating ORDER BY rating`),
      query(`SELECT DATE(submitted_at) AS date, COUNT(*)::int AS responses, ROUND(AVG(rating)::numeric,2) AS avg_rating
             FROM feedback_responses
             WHERE submitted_at >= NOW() - INTERVAL '30 days'
             GROUP BY DATE(submitted_at)
             ORDER BY date`),
    ]);

    const totalRequests  = reqRow.count;
    const totalResponses = respRow.count;
    return res.json({
      totalRequests,
      totalResponses,
      responseRate: totalRequests > 0 ? Math.round((totalResponses / totalRequests) * 100) : 0,
      averageRating: parseFloat(avgRow.avg) || 0,
      googlePrompted: googleRow.count,
      internalFlagged: flagRow.count,
      ratingDistribution: distRows,
      trend: trendRows,
    });
  } catch (err) {
    console.error('[Dashboard] /stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/responses', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const [responses, totalRow] = await Promise.all([
      query(
        `SELECT fr2.id AS response_id, fr2.rating, fr2.comment, fr2.submitted_at,
                fr2.routed_to_google, fr2.internal_flagged,
                c.name AS client_name, v.caregiver_name, v.visit_date
         FROM feedback_responses fr2
         JOIN feedback_requests fr ON fr.id = fr2.feedback_request_id
         JOIN clients c ON c.id = fr2.client_id
         JOIN visits  v ON v.id = fr.visit_id
         ORDER BY fr2.submitted_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      queryOne(`SELECT COUNT(*)::int AS count FROM feedback_responses`),
    ]);
    return res.json({ responses, total: totalRow.count, limit, offset });
  } catch (err) {
    console.error('[Dashboard] /responses error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
