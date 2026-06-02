'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');

// GET /api/dashboard/stats
router.get('/stats', (req, res) => {
  try {
    const db = getDb();

    const totalRequests = db.prepare(
      `SELECT COUNT(*) AS count FROM feedback_requests`
    ).get().count;

    const totalResponses = db.prepare(
      `SELECT COUNT(*) AS count FROM feedback_responses`
    ).get().count;

    const avgRating = db.prepare(
      `SELECT ROUND(AVG(rating), 2) AS avg FROM feedback_responses`
    ).get().avg;

    const googlePrompted = db.prepare(
      `SELECT COUNT(*) AS count FROM feedback_responses WHERE routed_to_google = 1`
    ).get().count;

    const internalFlagged = db.prepare(
      `SELECT COUNT(*) AS count FROM feedback_responses WHERE internal_flagged = 1`
    ).get().count;

    const responseRate = totalRequests > 0
      ? Math.round((totalResponses / totalRequests) * 100)
      : 0;

    // Rating distribution
    const ratingDist = db.prepare(`
      SELECT rating, COUNT(*) AS count
      FROM feedback_responses
      GROUP BY rating
      ORDER BY rating
    `).all();

    // 30-day trend
    const trend = db.prepare(`
      SELECT DATE(submitted_at) AS date,
             COUNT(*) AS responses,
             ROUND(AVG(rating), 2) AS avg_rating
      FROM feedback_responses
      WHERE submitted_at >= datetime('now', '-30 days')
      GROUP BY DATE(submitted_at)
      ORDER BY date
    `).all();

    return res.json({
      totalRequests,
      totalResponses,
      responseRate,
      averageRating: avgRating || 0,
      googlePrompted,
      internalFlagged,
      ratingDistribution: ratingDist,
      trend,
    });
  } catch (err) {
    console.error('[Dashboard] /stats error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/responses?limit=50&offset=0
router.get('/responses', (req, res) => {
  try {
    const db = getDb();
    const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    const responses = db.prepare(`
      SELECT
        fr2.id               AS response_id,
        fr2.rating,
        fr2.comment,
        fr2.submitted_at,
        fr2.routed_to_google,
        fr2.internal_flagged,
        c.name               AS client_name,
        v.caregiver_name,
        v.visit_date
      FROM feedback_responses fr2
      JOIN feedback_requests fr ON fr.id = fr2.feedback_request_id
      JOIN clients c ON c.id = fr2.client_id
      JOIN visits  v ON v.id = fr.visit_id
      ORDER BY fr2.submitted_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(`SELECT COUNT(*) AS count FROM feedback_responses`).get().count;

    return res.json({ responses, total, limit, offset });
  } catch (err) {
    console.error('[Dashboard] /responses error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
