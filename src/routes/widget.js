'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db');

// Public endpoint — only returns positive reviews with comments (safe to expose)
router.get('/reviews', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  try {
    const limit = Math.min(parseInt(req.query.limit || '12', 10), 30);
    const rows = await query(
      `SELECT fr2.rating, fr2.comment, fr2.submitted_at,
              c.name AS client_name, v.caregiver_name
       FROM feedback_responses fr2
       JOIN feedback_requests fr ON fr.id = fr2.feedback_request_id
       JOIN clients c ON c.id = fr2.client_id
       JOIN visits  v ON v.id = fr.visit_id
       WHERE fr2.rating >= 4
         AND fr2.comment IS NOT NULL
         AND fr2.comment <> ''
       ORDER BY fr2.submitted_at DESC
       LIMIT $1`,
      [limit]
    );
    // Anonymise: first name + last initial only
    const reviews = rows.map(r => ({
      rating: r.rating,
      comment: r.comment,
      caregiver: r.caregiver_name,
      author: formatName(r.client_name),
      date: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null,
    }));
    return res.json({ reviews, total: reviews.length });
  } catch (err) {
    console.error('[Widget] /reviews error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function formatName(full) {
  if (!full) return 'A. Client';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

module.exports = router;
