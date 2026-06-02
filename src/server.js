'use strict';

require('dotenv').config();

// Auto-enable demo mode when no database is configured
if (!process.env.DATABASE_URL) {
  process.env.DEMO_MODE = 'true';
}

const express   = require('express');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const feedbackRoutes  = require('./routes/feedback');
const clientsRoutes   = require('./routes/clients');
const dashboardRoutes = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter    = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

app.use('/api/feedback/submit', submitLimiter);
app.use('/api', apiLimiter);

app.use('/api/feedback',  feedbackRoutes);
app.use('/api/clients',   clientsRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.get('/feedback/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html'));
});

app.get('/', (req, res) => res.redirect('/dashboard.html'));

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

if (process.env.DEMO_MODE === 'true') {
  app.get('/api/demo/seed', async (req, res) => {
    try {
      const { query, queryOne } = require('./db');
      const { v4: uuidv4 } = require('uuid');

      const c1 = await queryOne(`INSERT INTO clients (name, phone, email, preferred_contact) VALUES ($1,$2,$3,$4) RETURNING *`, ['Margaret Johnson', '+15551234567', 'margaret@example.com', 'sms']);
      const c2 = await queryOne(`INSERT INTO clients (name, phone, email, preferred_contact) VALUES ($1,$2,$3,$4) RETURNING *`, ['Robert Chen', '+15559876543', 'robert@example.com', 'email']);
      const c3 = await queryOne(`INSERT INTO clients (name, phone, email, preferred_contact) VALUES ($1,$2,$3,$4) RETURNING *`, ['Dorothy Williams', '+15557654321', null, 'sms']);

      const v1 = await queryOne(`INSERT INTO visits (client_id, visit_date, caregiver_name, status) VALUES ($1,$2,$3,$4) RETURNING id`, [c1.id, '2026-06-01', 'Maria Rodriguez', 'completed']);
      const v2 = await queryOne(`INSERT INTO visits (client_id, visit_date, caregiver_name, status) VALUES ($1,$2,$3,$4) RETURNING id`, [c2.id, '2026-05-31', 'James Wilson', 'completed']);
      const v3 = await queryOne(`INSERT INTO visits (client_id, visit_date, caregiver_name, status) VALUES ($1,$2,$3,$4) RETURNING id`, [c3.id, '2026-05-30', 'Maria Rodriguez', 'completed']);
      const v4 = await queryOne(`INSERT INTO visits (client_id, visit_date, caregiver_name, status) VALUES ($1,$2,$3,$4) RETURNING id`, [c1.id, '2026-05-28', 'James Wilson', 'completed']);

      const seeds = [
        { v: v1, c: c1, rating: 5, comment: 'Maria was absolutely wonderful — so kind and attentive with my mother!', google: true },
        { v: v2, c: c2, rating: 2, comment: 'The caregiver arrived 45 minutes late and seemed distracted the whole time.', google: false },
        { v: v3, c: c3, rating: 4, comment: 'Very professional and caring. Would highly recommend.', google: true },
        { v: v4, c: c1, rating: 5, comment: null, google: true },
      ];

      for (const s of seeds) {
        const token = uuidv4();
        const fr = await queryOne(
          `INSERT INTO feedback_requests (visit_id, client_id, token, status, sent_at, channel) VALUES ($1,$2,$3,'responded',NOW(),'sms') RETURNING id`,
          [s.v.id, s.c.id, token]
        );
        await query(
          `INSERT INTO feedback_responses (feedback_request_id, client_id, rating, comment, routed_to_google, internal_flagged) VALUES ($1,$2,$3,$4,$5,$6)`,
          [fr.id, s.c.id, s.rating, s.comment, s.google, !s.google]
        );
      }

      res.json({ success: true, seeded: { clients: 3, visits: 4, responses: 4 } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`[Server] Running on http://localhost:${PORT}`));
}

module.exports = app;
