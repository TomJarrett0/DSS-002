// Run this once to create all tables and seed the forum categories.
// Usage: node setup-db.js

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set. Make sure you have a .env file.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, 'app/db/schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    console.log('Running schema…');
    await client.query(sql);
    console.log('Done. Tables created and categories seeded.');
  } catch (err) {
    console.error('Schema error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
