-- Credo — Esquema relacional de la Red Social Eclesiástica Internacional

CREATE TABLE IF NOT EXISTS ecclesiastical_units (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  official_latin_name TEXT,
  unit_type TEXT NOT NULL CHECK (unit_type IN (
    'holy_see',
    'dicastery',
    'episcopal_conference',
    'archdiocese',
    'diocese',
    'vicariate',
    'parish',
    'religious_order',
    'seminary'
  )),
  parent_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  country_code TEXT,
  country_name TEXT,
  city TEXT,
  rite TEXT NOT NULL DEFAULT 'Latin',
  patron_saint TEXT,
  motto TEXT,
  address TEXT,
  website TEXT,
  founded_year INTEGER,
  description TEXT,
  accent_color TEXT DEFAULT '#8B1E3F',
  verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_units_parent ON ecclesiastical_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_units_type ON ecclesiastical_units(unit_type);
CREATE INDEX IF NOT EXISTS idx_units_country ON ecclesiastical_units(country_code);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  title_prefix TEXT DEFAULT '',
  ecclesiastical_rank TEXT NOT NULL DEFAULT 'lay' CHECK (ecclesiastical_rank IN (
    'pope',
    'cardinal',
    'archbishop',
    'bishop',
    'monsignor',
    'priest',
    'deacon',
    'religious',
    'seminarian',
    'catechist',
    'lay'
  )),
  religious_order_initials TEXT DEFAULT '',
  primary_unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  religious_order_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  current_office_title TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  motto TEXT DEFAULT '',
  ordination_date DATE,
  country_code TEXT DEFAULT 'VA',
  languages TEXT[] NOT NULL DEFAULT ARRAY['es'],
  preferred_locale TEXT NOT NULL DEFAULT 'es',
  avatar_color TEXT NOT NULL DEFAULT '#7A1C2E',
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
    'unverified',
    'pending',
    'verified'
  )),
  verification_note TEXT DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_rank ON users(ecclesiastical_rank);
CREATE INDEX IF NOT EXISTS idx_users_primary_unit ON users(primary_unit_id);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_code);

CREATE TABLE IF NOT EXISTS user_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES ecclesiastical_units(id) ON DELETE CASCADE,
  role_title TEXT NOT NULL,
  start_year INTEGER,
  end_year INTEGER,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_user ON user_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_unit ON user_assignments(unit_id);

CREATE TABLE IF NOT EXISTS follows (
  id SERIAL PRIMARY KEY,
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  target_unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (target_user_id IS NOT NULL AND target_unit_id IS NULL) OR
    (target_user_id IS NULL AND target_unit_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_user_unique
  ON follows(follower_id, target_user_id) WHERE target_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_follows_unit_unique
  ON follows(follower_id, target_unit_id) WHERE target_unit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  post_type TEXT NOT NULL DEFAULT 'reflection' CHECK (post_type IN (
    'homily',
    'pastoral_letter',
    'announcement',
    'decree',
    'reflection',
    'event'
  )),
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  scripture_ref TEXT DEFAULT '',
  event_date TIMESTAMPTZ,
  event_location TEXT DEFAULT '',
  language TEXT NOT NULL DEFAULT 'es',
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_scope ON posts(scope_unit_id);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_reactions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL DEFAULT 'amen' CHECK (reaction_type IN ('amen', 'pray', 'gratitude')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(post_id, user_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_reactions_post ON post_reactions(post_id);

CREATE TABLE IF NOT EXISTS post_comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct', 'pastoral_group')),
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_unit ON conversations(unit_id);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('moderator', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at ASC);

-- Visual Instagram-style upgrades (idempotent migrations for existing databases)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS visual_theme TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS media_assets (
  id SERIAL PRIMARY KEY,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mime_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stories (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  image_url TEXT DEFAULT '',
  caption TEXT DEFAULT '',
  scripture_ref TEXT DEFAULT '',
  bg_gradient TEXT DEFAULT 'linear-gradient(145deg,#7A1C2E,#3E0D17)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at DESC);

CREATE TABLE IF NOT EXISTS saved_posts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, post_id)
);

-- Credo Ecosystem v2: Video sync, Live Radio/TV, Prayer Wall, Parish Schedules, Offerings & Credo Plus
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_kind TEXT NOT NULL DEFAULT 'article';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS youtube_id TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS video_duration TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS channel_name TEXT DEFAULT '';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_source_url ON posts(source_url) WHERE source_url <> '';

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_credo_plus BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS credo_plus_plan TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_ceo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS website_links JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ecclesiastical_units ADD COLUMN IF NOT EXISTS mass_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ecclesiastical_units ADD COLUMN IF NOT EXISTS confession_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ecclesiastical_units ADD COLUMN IF NOT EXISTS notices JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ecclesiastical_units ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE ecclesiastical_units ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS live_channels (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('radio', 'tv')),
  tagline TEXT DEFAULT '',
  current_program TEXT DEFAULT '',
  host_name TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  country_code TEXT DEFAULT 'DO',
  city TEXT DEFAULT '',
  accent_color TEXT NOT NULL DEFAULT '#C8A253',
  cover_url TEXT DEFAULT '',
  stream_url TEXT DEFAULT '',
  youtube_live_id TEXT DEFAULT '',
  is_hero BOOLEAN NOT NULL DEFAULT FALSE,
  is_live BOOLEAN NOT NULL DEFAULT TRUE,
  listeners_count INTEGER NOT NULL DEFAULT 120,
  sort_order INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prayer_intentions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES ecclesiastical_units(id) ON DELETE SET NULL,
  author_display TEXT NOT NULL DEFAULT 'Fiel anónimo',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  category TEXT NOT NULL DEFAULT 'family' CHECK (category IN ('health', 'family', 'peace', 'vocation', 'gratitude', 'urgent')),
  is_urgent BOOLEAN NOT NULL DEFAULT FALSE,
  content TEXT NOT NULL,
  prayers_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prayers_created ON prayer_intentions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayers_urgent ON prayer_intentions(is_urgent, prayers_count DESC);

CREATE TABLE IF NOT EXISTS prayer_logs (
  id SERIAL PRIMARY KEY,
  intention_id INTEGER NOT NULL REFERENCES prayer_intentions(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_key TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prayer_logs_user
  ON prayer_logs(intention_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prayer_logs_device
  ON prayer_logs(intention_id, device_key) WHERE user_id IS NULL AND device_key <> '';

CREATE TABLE IF NOT EXISTS parish_offerings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  unit_id INTEGER NOT NULL REFERENCES ecclesiastical_units(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  frequency TEXT NOT NULL DEFAULT 'one_time' CHECK (frequency IN ('one_time', 'monthly')),
  intention_note TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rosary_audio_tracks (
  id SERIAL PRIMARY KEY,
  uploader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  slot_type TEXT NOT NULL CHECK (slot_type IN ('joyful', 'sorrowful', 'glorious', 'luminous', 'promo', 'interlude')),
  title TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rosary_tracks_slot ON rosary_audio_tracks(slot_type, created_at DESC);
