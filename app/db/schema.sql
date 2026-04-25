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
  username character varying(30) NOT NULL,
  email character varying(255) NOT NULL,
  password_hash character varying(255) NOT NULL,
  role character varying(10) DEFAULT 'user'::character varying NOT NULL,
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  subscription_status boolean DEFAULT false,
  is_suspended boolean DEFAULT false,
  twofa_enabled boolean DEFAULT false,
  twofa_secret_encrypted text,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  failed_login_attempts integer DEFAULT 0 NOT NULL,
  lockout_until timestamp with time zone,
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  CONSTRAINT users_role_check CHECK (((role)::text = ANY ((ARRAY['user'::character varying, 'admin'::character varying])::text[])))
);

-- Forum categories
CREATE TABLE IF NOT EXISTS categories (
    name character varying(100) NOT NULL,
    description text NOT NULL,
    icon character varying(10) DEFAULT '🎮'::character varying NOT NULL,
    slug character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);

-- Posts (the opening post + all replies within a thread)
CREATE TABLE IF NOT EXISTS posts (
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  updated_at timestamp without time zone DEFAULT now() NOT NULL,
  author_id uuid,
  title text NOT NULL,
  slug text NOT NULL,
  body text,
  visibility text DEFAULT 'private'::text,
  status text DEFAULT 'draft'::text,
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  category_id uuid,
  CONSTRAINT chk_status CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text]))),
  CONSTRAINT chk_visibility CHECK ((visibility = ANY (ARRAY['public'::text, 'premium'::text, 'private'::text])))
);

-- Comments (replies to posts, can be nested)
CREATE TABLE comments (
    content text NOT NULL,
    is_edited boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid,
    user_id uuid,
    parent_comment_id uuid
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
