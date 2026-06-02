'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'arise_feedback.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      phone       TEXT,
      email       TEXT,
      preferred_contact TEXT NOT NULL DEFAULT 'sms' CHECK(preferred_contact IN ('sms','email','both')),
      opt_out     INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS visits (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      visit_date     TEXT NOT NULL,
      caregiver_name TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','cancelled','no_show')),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback_requests (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      visit_id       INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      token          TEXT NOT NULL UNIQUE,
      sent_at        TEXT,
      channel        TEXT CHECK(channel IN ('sms','email','both')),
      status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','responded','opted_out','failed')),
      scheduled_for  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback_responses (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_request_id  INTEGER NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
      client_id            INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      rating               INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment              TEXT,
      submitted_at         TEXT NOT NULL DEFAULT (datetime('now')),
      routed_to_google     INTEGER NOT NULL DEFAULT 0,
      internal_flagged     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      feedback_request_id INTEGER NOT NULL REFERENCES feedback_requests(id) ON DELETE CASCADE,
      scheduled_for       TEXT NOT NULL,
      sent_at             TEXT,
      status              TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','cancelled','failed'))
    );

    CREATE INDEX IF NOT EXISTS idx_feedback_requests_token ON feedback_requests(token);
    CREATE INDEX IF NOT EXISTS idx_feedback_requests_status ON feedback_requests(status);
    CREATE INDEX IF NOT EXISTS idx_feedback_requests_scheduled ON feedback_requests(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_status ON follow_ups(status);
    CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled ON follow_ups(scheduled_for);
  `);

  console.log('[DB] Schema initialized at', DB_PATH);
}

module.exports = { getDb };
