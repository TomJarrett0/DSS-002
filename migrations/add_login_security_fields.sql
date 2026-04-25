-- ============================================================
-- Migration: add login security fields to users table
-- Run once against the live database.
-- Usage: psql $DATABASE_URL -f migrations/add_login_security_fields.sql
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS is idempotent in PostgreSQL 9.6+.
-- Running this script twice will not error or lose data.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lockout_until TIMESTAMPTZ;

-- failed_login_attempts: incremented on each wrong password.
--   Resets to 0 on successful login.
-- lockout_until: if set and in the future, all login attempts are rejected
--   with 423 before bcrypt runs. NULL means the account is not locked.
