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

ALTER TABLE stories ADD COLUMN IF NOT EXISTS video_url TEXT DEFAULT '';
ALTER TABLE stories ADD COLUMN IF NOT EXISTS youtube_id TEXT DEFAULT '';

-- ============================================================================
-- MASSIVE-SCALE PERFORMANCE OPTIMIZATION: INDEXES, COUNTERS & FTS
-- ============================================================================

-- Allow church/parish user accounts for direct document-based church onboarding
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_ecclesiastical_rank_check;
ALTER TABLE users ADD CONSTRAINT users_ecclesiastical_rank_check CHECK (ecclesiastical_rank IN (
  'pope',
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
  'church',
  'parish',
  'religious',
  'seminarian',
  'catechist',
  'lay'
));

-- Case-insensitive O(log N) login & lookup indexes
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
CREATE INDEX IF NOT EXISTS idx_users_fts ON users USING GIN (
  to_tsvector('simple', COALESCE(full_name, '') || ' ' || COALESCE(username, '') || ' ' || COALESCE(current_office_title, ''))
);

-- Hot-path composite, partial & covering indexes for instant feed/vids/profile queries
CREATE INDEX IF NOT EXISTS idx_posts_feed_order ON posts(is_pinned DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type_created ON posts(post_type, is_pinned DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_media_kind_created ON posts(media_kind, is_pinned DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_videos_created ON posts(created_at DESC, id DESC) WHERE media_kind = 'video' OR youtube_id <> '';
CREATE INDEX IF NOT EXISTS idx_posts_fts ON posts USING GIN (
  to_tsvector('spanish', COALESCE(title, '') || ' ' || COALESCE(content, '') || ' ' || COALESCE(scripture_ref, ''))
);

-- Fast lookups for reactions, comments, saves, follows, stories & prayers
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON post_comments(post_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_reactions_user_post ON post_reactions(user_id, post_id, reaction_type);
CREATE INDEX IF NOT EXISTS idx_saved_posts_post ON saved_posts(post_id, user_id);
CREATE INDEX IF NOT EXISTS idx_follows_target_user ON follows(target_user_id) WHERE target_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayers_cat_created ON prayer_intentions(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prayer_logs_user_int ON prayer_logs(user_id, intention_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prayer_logs_dev_int ON prayer_logs(device_key, intention_id) WHERE user_id IS NULL AND device_key <> '';

-- Safe optional pg_trgm acceleration for instant substring ILIKE search
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_posts_title_trgm ON posts USING GIN (title gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING GIN (content gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_users_name_trgm ON users USING GIN (full_name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_users_uname_trgm ON users USING GIN (username gin_trgm_ops);
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Denormalized O(1) counters (eliminates per-page GROUP BY and COUNT(*) full scans)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS amen_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS pray_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS gratitude_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS comments_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS followers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS following_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS posts_count INTEGER NOT NULL DEFAULT 0;

-- Trigger: maintain post reaction counters in O(1)
CREATE OR REPLACE FUNCTION credo_sync_post_reaction_counts() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET
      amen_count = amen_count + CASE WHEN NEW.reaction_type = 'amen' THEN 1 ELSE 0 END,
      pray_count = pray_count + CASE WHEN NEW.reaction_type = 'pray' THEN 1 ELSE 0 END,
      gratitude_count = gratitude_count + CASE WHEN NEW.reaction_type = 'gratitude' THEN 1 ELSE 0 END
    WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET
      amen_count = GREATEST(0, amen_count - CASE WHEN OLD.reaction_type = 'amen' THEN 1 ELSE 0 END),
      pray_count = GREATEST(0, pray_count - CASE WHEN OLD.reaction_type = 'pray' THEN 1 ELSE 0 END),
      gratitude_count = GREATEST(0, gratitude_count - CASE WHEN OLD.reaction_type = 'gratitude' THEN 1 ELSE 0 END)
    WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credo_post_reactions ON post_reactions;
CREATE TRIGGER trg_credo_post_reactions
  AFTER INSERT OR DELETE ON post_reactions
  FOR EACH ROW EXECUTE FUNCTION credo_sync_post_reaction_counts();

-- Trigger: maintain post comment count in O(1)
CREATE OR REPLACE FUNCTION credo_sync_post_comment_counts() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE posts SET comments_count = GREATEST(0, comments_count - 1) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credo_post_comments ON post_comments;
CREATE TRIGGER trg_credo_post_comments
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION credo_sync_post_comment_counts();

-- Trigger: maintain user posts_count in O(1)
CREATE OR REPLACE FUNCTION credo_sync_user_posts_count() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET posts_count = posts_count + 1 WHERE id = NEW.author_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET posts_count = GREATEST(0, posts_count - 1) WHERE id = OLD.author_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credo_user_posts ON posts;
CREATE TRIGGER trg_credo_user_posts
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION credo_sync_user_posts_count();

-- Trigger: maintain user followers/following counts in O(1)
CREATE OR REPLACE FUNCTION credo_sync_follow_counts() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    IF NEW.target_user_id IS NOT NULL THEN
      UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.target_user_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    IF OLD.target_user_id IS NOT NULL THEN
      UPDATE users SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.target_user_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_credo_follows ON follows;
CREATE TRIGGER trg_credo_follows
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION credo_sync_follow_counts();

-- Reconcile denormalized counters once if any mismatch exists
UPDATE posts p SET
  amen_count = COALESCE((SELECT COUNT(*)::int FROM post_reactions pr WHERE pr.post_id = p.id AND pr.reaction_type = 'amen'), 0),
  pray_count = COALESCE((SELECT COUNT(*)::int FROM post_reactions pr WHERE pr.post_id = p.id AND pr.reaction_type = 'pray'), 0),
  gratitude_count = COALESCE((SELECT COUNT(*)::int FROM post_reactions pr WHERE pr.post_id = p.id AND pr.reaction_type = 'gratitude'), 0),
  comments_count = COALESCE((SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id), 0)
WHERE
  p.amen_count <> COALESCE((SELECT COUNT(*)::int FROM post_reactions pr WHERE pr.post_id = p.id AND pr.reaction_type = 'amen'), 0)
  OR p.comments_count <> COALESCE((SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id), 0);

UPDATE users u SET
  posts_count = COALESCE((SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id), 0),
  followers_count = COALESCE((SELECT COUNT(*)::int FROM follows f WHERE f.target_user_id = u.id), 0),
  following_count = COALESCE((SELECT COUNT(*)::int FROM follows f WHERE f.follower_id = u.id), 0)
WHERE
  u.posts_count <> COALESCE((SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id), 0)
  OR u.followers_count <> COALESCE((SELECT COUNT(*)::int FROM follows f WHERE f.target_user_id = u.id), 0)
  OR u.following_count <> COALESCE((SELECT COUNT(*)::int FROM follows f WHERE f.follower_id = u.id), 0);

-- ============================================================================
-- FAMILIA CREDO ONE & CREDO ONE STUDIO — SUBSCRIPTIONS, RBAC, CAMPAIGNS, AUDIT
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_plan_sku TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_free BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS studio_eligible BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS one_badge TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS subscription_plans (
  sku TEXT PRIMARY KEY,
  audience TEXT NOT NULL CHECK (audience IN ('user', 'business')),
  display_name TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  price_monthly_cents INTEGER NOT NULL DEFAULT 0,
  price_annual_cents INTEGER NOT NULL DEFAULT 0,
  is_popular BOOLEAN NOT NULL DEFAULT FALSE,
  is_enterprise BOOLEAN NOT NULL DEFAULT FALSE,
  max_seats INTEGER NOT NULL DEFAULT 1, -- -1 = unlimited
  monthly_impressions INTEGER NOT NULL DEFAULT 0,
  max_active_campaigns INTEGER NOT NULL DEFAULT 0, -- -1 = unlimited
  ad_free BOOLEAN NOT NULL DEFAULT FALSE,
  can_publish_open BOOLEAN NOT NULL DEFAULT FALSE,
  studio_access BOOLEAN NOT NULL DEFAULT FALSE,
  approval_workflow BOOLEAN NOT NULL DEFAULT FALSE,
  audit_logs_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  badge_type TEXT NOT NULL DEFAULT 'none',
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  paypal_product_id TEXT NOT NULL DEFAULT '',
  paypal_plan_id_monthly TEXT NOT NULL DEFAULT '',
  paypal_plan_id_annual TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  org_type TEXT NOT NULL DEFAULT 'business' CHECK (org_type IN ('personal', 'business', 'parish', 'enterprise')),
  badge_type TEXT NOT NULL DEFAULT 'verified_business' CHECK (badge_type IN (
    'none', 'one_plus', 'verified_personal', 'verified_business', 'enterprise_gold'
  )),
  avatar_style TEXT NOT NULL DEFAULT 'circle' CHECK (avatar_style IN ('circle', 'square')),
  avatar_url TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#0A84FF',
  country_code TEXT NOT NULL DEFAULT 'DO',
  city TEXT NOT NULL DEFAULT '',
  website_url TEXT NOT NULL DEFAULT '',
  whatsapp_number TEXT NOT NULL DEFAULT '',
  parent_org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approval_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orgs_owner ON organizations(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_orgs_parent ON organizations(parent_org_id) WHERE parent_org_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_members (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'moderator', 'analyst')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'revoked')),
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_user_unique
  ON organization_members(organization_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_members_email_unique
  ON organization_members(organization_id, LOWER(invited_email)) WHERE invited_email <> '';
CREATE INDEX IF NOT EXISTS idx_org_members_user_active
  ON organization_members(user_id, status) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  plan_sku TEXT NOT NULL REFERENCES subscription_plans(sku),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'annual', 'custom')),
  paypal_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended', 'cancelled', 'expired')),
  impressions_quota INTEGER NOT NULL DEFAULT 0,
  impressions_used INTEGER NOT NULL DEFAULT 0,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_status ON subscriptions(organization_id, status) WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_transactions (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  paypal_event_id TEXT UNIQUE,
  paypal_sale_id TEXT DEFAULT '',
  plan_sku TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'completed',
  description TEXT NOT NULL DEFAULT '',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_user ON billing_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_tx_org ON billing_transactions(organization_id, created_at DESC) WHERE organization_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  creator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  post_id INTEGER REFERENCES posts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL DEFAULT '',
  media_kind TEXT NOT NULL DEFAULT 'photo' CHECK (media_kind IN ('photo', 'video', 'article')),
  objective TEXT NOT NULL DEFAULT 'whatsapp',
  cta_type TEXT NOT NULL DEFAULT 'whatsapp' CHECK (cta_type IN ('whatsapp', 'web', 'offering', 'event_register', 'lead_form')),
  cta_label TEXT NOT NULL DEFAULT 'Ir a WhatsApp',
  cta_url TEXT NOT NULL DEFAULT '',
  target_country TEXT NOT NULL DEFAULT 'ALL',
  target_city TEXT NOT NULL DEFAULT '',
  target_category TEXT NOT NULL DEFAULT 'general',
  impressions_allocated INTEGER NOT NULL DEFAULT 5000 CHECK (impressions_allocated > 0),
  impressions_served INTEGER NOT NULL DEFAULT 0,
  clicks_count INTEGER NOT NULL DEFAULT 0,
  unique_reach INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'draft', 'pending_approval', 'scheduled', 'active', 'paused', 'completed', 'rejected'
  )),
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_delivery
  ON campaigns(status, target_country, updated_at DESC)
  WHERE status = 'active' AND impressions_served < impressions_allocated;
CREATE INDEX IF NOT EXISTS idx_campaigns_org_status ON campaigns(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_metrics_daily (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL DEFAULT CURRENT_DATE,
  organic_impressions INTEGER NOT NULL DEFAULT 0,
  boosted_impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  unique_viewers INTEGER NOT NULL DEFAULT 0,
  live_peak_viewers INTEGER NOT NULL DEFAULT 0,
  UNIQUE(campaign_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_org_date
  ON campaign_metrics_daily(organization_id, metric_date DESC);

CREATE TABLE IF NOT EXISTS campaign_events_dedup (
  id BIGSERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('impression', 'click')),
  bucket_hour TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, session_key, event_type, bucket_hour)
);

CREATE INDEX IF NOT EXISTS idx_campaign_dedup_created ON campaign_events_dedup(created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'returned')),
  reviewer_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approvals_org_status ON approval_requests(organization_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS enterprise_leads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  tax_id TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_role TEXT NOT NULL,
  corporate_email TEXT NOT NULL,
  whatsapp_phone TEXT NOT NULL,
  campaign_goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enterprise_leads_created ON enterprise_leads(created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_leads (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_leads_org ON campaign_leads(organization_id, created_at DESC);


