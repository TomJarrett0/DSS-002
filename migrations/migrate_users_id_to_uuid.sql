-- ============================================================
-- Migration: convert users.id from serial integer to UUID
-- Run once against the live database.
-- Usage: psql $DATABASE_URL -f migrations/migrate_users_id_to_uuid.sql
--
-- This migration:
--   1. Adds a new uuid column to users
--   2. Populates it with generated UUIDs
--   3. Drops the old integer PK and promotes the uuid column
--   4. Clears stale sessions so all users re-authenticate with UUID ids
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 1: add a staging UUID column
ALTER TABLE users ADD COLUMN IF NOT EXISTS new_id UUID DEFAULT gen_random_uuid();

-- Step 2: populate any rows that somehow still have NULL
UPDATE users SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- Step 3: drop dependent FK constraints (re-added at the end)
ALTER TABLE posts    DROP CONSTRAINT IF EXISTS posts_author_id_fkey;
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_user_id_fkey;

-- Step 4: drop the old integer PK
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE users DROP COLUMN IF EXISTS id;

-- Step 5: rename new_id → id and set as primary key
ALTER TABLE users RENAME COLUMN new_id TO id;
ALTER TABLE users ALTER COLUMN id SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

-- Step 6: clear stale sessions so everyone re-logs in with a UUID session
DELETE FROM session;

-- Step 7: restore FK constraints (safe — posts/comments.author_id/user_id are already uuid)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_author_id_fkey') THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_user_id_fkey') THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
