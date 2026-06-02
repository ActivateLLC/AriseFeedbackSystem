'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { createFeedbackRequest, sendFeedbackRequest } = require('../feedback');

// POST /api/clients — add a new client
router.post('/', (req, res) => {
  try {
    const { name, phone, email, preferred_contact = 'sms' } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO clients (name, phone, email, preferred_contact)
      VALUES (@name, @phone, @email, @preferred_contact)
    `);
    const result = stmt.run({ name, phone: phone || null, email: email || null, preferred_contact });
    return res.status(201).json({ id: result.lastInsertRowid, name, phone, email, preferred_contact });
  } catch (err) {
    console.error('[Clients] POST / error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/clients — list all clients
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const clients = db.prepare(`
      SELECT c.*,
             COUNT(v.id) AS visit_count
      FROM clients c
      LEFT JOIN visits v ON v.client_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();
    return res.json(clients);
  } catch (err) {
    console.error('[Clients] GET / error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id — get single client
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    return res.json(client);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id — update client
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const { name, phone, email, preferred_contact, opt_out } = req.body;
    const updated = {
      name:              name              ?? existing.name,
      phone:             phone             ?? existing.phone,
      email:             email             ?? existing.email,
      preferred_contact: preferred_contact ?? existing.preferred_contact,
      opt_out:           opt_out           != null ? (opt_out ? 1 : 0) : existing.opt_out,
      id:                parseInt(req.params.id, 10),
    };

    db.prepare(`
      UPDATE clients
      SET name=@name, phone=@phone, email=@email,
          preferred_contact=@preferred_contact, opt_out=@opt_out
      WHERE id=@id
    `).run(updated);

    return res.json({ ...existing, ...updated });
  } catch (err) {
    console.error('[Clients] PUT /:id error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/visit — record a visit and optionally trigger feedback
router.post('/:id/visit', async (req, res) => {
  try {
    const db = getDb();
    const client = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { visit_date, caregiver_name, status = 'completed', trigger_feedback = true } = req.body;
    if (!visit_date || !caregiver_name) {
      return res.status(400).json({ error: 'visit_date and caregiver_name are required' });
    }

    const visitResult = db.prepare(`
      INSERT INTO visits (client_id, visit_date, caregiver_name, status)
      VALUES (@client_id, @visit_date, @caregiver_name, @status)
    `).run({ client_id: client.id, visit_date, caregiver_name, status });

    const visitId = visitResult.lastInsertRowid;
    let feedbackRequest = null;

    if (trigger_feedback && !client.opt_out) {
      const { id: reqId, token } = createFeedbackRequest(visitId, client.id);
      feedbackRequest = { id: reqId, token };
      // Send immediately (fire-and-forget)
      sendFeedbackRequest(reqId).catch(err =>
        console.error(`[Clients] sendFeedbackRequest failed for req ${reqId}:`, err.message)
      );
    }

    return res.status(201).json({
      visitId,
      clientId: client.id,
      feedbackRequest,
    });
  } catch (err) {
    console.error('[Clients] POST /:id/visit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
