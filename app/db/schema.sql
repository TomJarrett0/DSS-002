-- ============================================================
-- GameVault Forum - Database Schema
-- Run this file once against your PostgreSQL database to set up
-- all required tables and seed data.
-- Usage: psql $DATABASE_URL -f app/db/schema.sql
-- ============================================================

-- Session table (required by connect-pg-simple for session storage)
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR   NOT NULL COLLATE "default",
  "sess"   JSON      NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
ALTER TABLE "session"
  ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(30)  UNIQUE NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),

  -- Brute-force protection fields (see app/middleware/accountLockout.js)
  -- failed_login_attempts: incremented on each wrong password, reset on success.
  -- lockout_until: if set and in the future, all login attempts are rejected.
  failed_login_attempts INTEGER  NOT NULL DEFAULT 0,
  lockout_until         TIMESTAMPTZ
);

-- Forum categories
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  description TEXT         NOT NULL,
  icon        VARCHAR(10)  NOT NULL DEFAULT '🎮',
  slug        VARCHAR(100) UNIQUE NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Threads (topics within a category)
CREATE TABLE IF NOT EXISTS threads (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  category_id INTEGER      NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  user_id     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Posts (the opening post + all replies within a thread)
CREATE TABLE IF NOT EXISTS posts (
  id         SERIAL PRIMARY KEY,
  content    TEXT    NOT NULL,
  thread_id  INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Seed data - default categories
-- ============================================================
INSERT INTO categories (name, description, icon, slug) VALUES
  ('General Discussion', 'Talk about anything and everything gaming related.',              '🎮', 'general'),
  ('FPS & Shooters',     'Call of Duty, Valorant, Battlefield and all things first-person.','🔫', 'fps-shooters'),
  ('RPG & Adventure',    'From Elden Ring to Final Fantasy — epic journeys welcome.',        '⚔️', 'rpg-adventure'),
  ('Strategy & Sim',     'Grand strategy, city builders, 4X games and more.',               '🧠', 'strategy-sim'),
  ('Sports & Racing',    'FIFA, F1, Forza — competitive sports titles.',                     '🏎️', 'sports-racing'),
  ('Indie Games',        'Hidden gems, passion projects, and indie scene discussion.',       '🎨', 'indie-games'),
  ('Hardware & Tech',    'GPUs, consoles, peripherals and gaming setups.',                   '💻', 'hardware-tech')
ON CONFLICT (slug) DO NOTHING;
