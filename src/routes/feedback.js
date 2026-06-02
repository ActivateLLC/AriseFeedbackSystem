'use strict';

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const {
  createFeedbackRequest, sendFeedbackRequest, processFeedbackResponse, getFeedbackInfo,
} = require('../feedback');

router.post('/trigger', async (req, res) => {
  try {
    const { visitId, clientId, scheduleNow = true } = req.body;
    if (!visitId || !clientId) return res.status(400).json({ error: 'visitId and clientId are required' });
    const { id, token } = await createFeedbackRequest(parseInt(visitId, 10), parseInt(clientId, 10));
    if (scheduleNow) {
      sendFeedbackRequest(id).catch(err => console.error(`[Route] sendFeedbackRequest failed id=${id}:`, err.message));
    }
    return res.json({ success: true, requestId: id, token });
  } catch (err) {
    console.error('[Route] /trigger error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/info/:token', async (req, res) => {
  try {
    const info = await getFeedbackInfo(req.params.token);
    if (!info) return res.status(404).json({ error: 'Invalid or expired token' });
    return res.json({ ...info, alreadySubmitted: info.status === 'responded' });
  } catch (err) {
    console.error('[Route] /info error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/submit', async (req, res) => {
  try {
    const { token, rating, comment } = req.body;
    if (!token || rating == null) return res.status(400).json({ error: 'token and rating are required' });
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'rating must be between 1 and 5' });
    const result = await processFeedbackResponse(token, ratingNum, comment || null);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Route] /submit error:', err.message);
    if (err.message.includes('Invalid or expired')) return res.status(404).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

router.get('/unsubscribe/:token', async (req, res) => {
  try {
    const row = await queryOne(
      `SELECT client_id FROM feedback_requests WHERE token = $1`,
      [req.params.token]
    );
    if (!row) return res.status(404).send('<h2>Invalid link.</h2>');
    await query(`UPDATE clients SET opt_out = true WHERE id = $1`, [row.client_id]);
    await query(
      `UPDATE feedback_requests SET status='opted_out' WHERE token=$1 AND status='pending'`,
      [req.params.token]
    );
    return res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed — Arise Cares</title><style>body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;background:#f0f7f4;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#fff;border-radius:16px;padding:40px 32px;max-width:400px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}h2{color:#2d9cdb;margin:0 0 16px}p{color:#555;line-height:1.6}</style></head><body><div class="card"><h2>You've Been Unsubscribed</h2><p>You will no longer receive feedback requests from Arise Cares.<br>If this was a mistake, please contact us directly.</p></div></body></html>`);
  } catch (err) {
    console.error('[Route] /unsubscribe error:', err.message);
    return res.status(500).send('<h2>Something went wrong. Please try again.</h2>');
  }
});

module.exports = router;
