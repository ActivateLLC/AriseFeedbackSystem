'use strict';

if (process.env.DEMO_MODE === 'true' && !process.env.DATABASE_URL) {
  console.log('[DB] DEMO_MODE: using in-memory mock database');
  module.exports = require('./db-mock');
} else {

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Helper: run a parameterized query, returns rows array
async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// Helper: run query, return first row or null
async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

module.exports = { pool, query, queryOne };

} // end DEMO_MODE else block
