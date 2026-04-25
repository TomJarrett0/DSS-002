-- UUID forum constraints/indexes migration
-- Safe to run on an existing database.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helpful indexes for category/article/comment endpoints
CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories (slug);
CREATE INDEX IF NOT EXISTS idx_posts_category_visibility_status_created_at
  ON posts (category_id, visibility, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at
  ON comments (post_id, created_at ASC);

COMMIT;

-- Add FK constraints if they are missing (idempotent via pg_constraint checks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_author_id_fkey'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_category_id_fkey'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT posts_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_post_id_fkey'
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_post_id_fkey
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_user_id_fkey'
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comments_parent_comment_id_fkey'
  ) THEN
    ALTER TABLE comments
      ADD CONSTRAINT comments_parent_comment_id_fkey
      FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE;
  END IF;
END
$$;
