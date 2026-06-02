'use strict';

require('dotenv').config();
const express      = require('express');
const path         = require('path');
const rateLimit    = require('express-rate-limit');

const { getDb }         = require('./db');
const { startScheduler } = require('./scheduler');

const feedbackRoutes  = require('./routes/feedback');
const clientsRoutes   = require('./routes/clients');
const dashboardRoutes = require('./routes/dashboard');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (feedback.html, dashboard.html)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiter for form submission endpoint
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this IP, please try again later.' },
});

// General API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/feedback/submit', submitLimiter);
app.use('/api', apiLimiter);

app.use('/api/feedback',   feedbackRoutes);
app.use('/api/clients',    clientsRoutes);
app.use('/api/dashboard',  dashboardRoutes);

// Serve the feedback form for GET /feedback/:token
app.get('/feedback/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'feedback.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────

function start() {
  // Initialize DB (creates tables if needed)
  getDb();

  // Start cron scheduler
  startScheduler();

  app.listen(PORT, () => {
    console.log(`[Server] Arise Feedback System running on http://localhost:${PORT}`);
    console.log(`[Server] Feedback form: http://localhost:${PORT}/feedback/<token>`);
    console.log(`[Server] Dashboard:     http://localhost:${PORT}/dashboard.html`);
  });
}

start();

module.exports = app; // export for testing
