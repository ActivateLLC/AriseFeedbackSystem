'use strict';

const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../db');
const { createFeedbackRequest, sendFeedbackRequest } = require('../feedback');

router.post('/', async (req, res) => {
  try {
    const { name, phone, email, preferred_contact = 'sms' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const row = await queryOne(
      `INSERT INTO clients (name, phone, email, preferred_contact) VALUES ($1,$2,$3,$4) RETURNING *`,
      [name, phone || null, email || null, preferred_contact]
    );
    return res.status(201).json(row);
  } catch (err) {
    console.error('[Clients] POST / error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const clients = await query(
      `SELECT c.*, COUNT(v.id)::int AS visit_count
       FROM clients c
       LEFT JOIN visits v ON v.client_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );
    return res.json(clients);
  } catch (err) {
    console.error('[Clients] GET / error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const client = await queryOne(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    return res.json(client);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const existing = await queryOne(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    const { name, phone, email, preferred_contact, opt_out } = req.body;
    const updated = await queryOne(
      `UPDATE clients SET
         name=$1, phone=$2, email=$3, preferred_contact=$4, opt_out=$5
       WHERE id=$6 RETURNING *`,
      [
        name ?? existing.name,
        phone ?? existing.phone,
        email ?? existing.email,
        preferred_contact ?? existing.preferred_contact,
        opt_out != null ? Boolean(opt_out) : existing.opt_out,
        req.params.id,
      ]
    );
    return res.json(updated);
  } catch (err) {
    console.error('[Clients] PUT /:id error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/visit', async (req, res) => {
  try {
    const client = await queryOne(`SELECT * FROM clients WHERE id = $1`, [req.params.id]);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const { visit_date, caregiver_name, status = 'completed', trigger_feedback = true } = req.body;
    if (!visit_date || !caregiver_name) return res.status(400).json({ error: 'visit_date and caregiver_name are required' });
    const visitRow = await queryOne(
      `INSERT INTO visits (client_id, visit_date, caregiver_name, status) VALUES ($1,$2,$3,$4) RETURNING id`,
      [client.id, visit_date, caregiver_name, status]
    );
    const visitId = visitRow.id;
    let feedbackRequest = null;
    if (trigger_feedback && !client.opt_out) {
      const { id: reqId, token } = await createFeedbackRequest(visitId, client.id);
      feedbackRequest = { id: reqId, token };
      sendFeedbackRequest(reqId).catch(err => console.error(`[Clients] sendFeedbackRequest failed req=${reqId}:`, err.message));
    }
    return res.status(201).json({ visitId, clientId: client.id, feedbackRequest });
  } catch (err) {
    console.error('[Clients] POST /:id/visit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
