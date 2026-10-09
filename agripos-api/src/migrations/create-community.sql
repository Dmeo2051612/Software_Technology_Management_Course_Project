-- Additive community/platform foundation. Run using npm run community:setup.
CREATE TABLE IF NOT EXISTS agrilink_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(150) NOT NULL,
  bio text NOT NULL DEFAULT '', region varchar(100) NOT NULL DEFAULT '',
  community_enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agrilink_memberships (
  user_id uuid NOT NULL REFERENCES users(id), organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  can_publish boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(user_id, organization_id)
);
CREATE TABLE IF NOT EXISTS agrilink_platform_roles (
  user_id uuid PRIMARY KEY REFERENCES users(id), role varchar(30) NOT NULL CHECK(role IN ('admin','moderator'))
);
CREATE TABLE IF NOT EXISTS community_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id), display_name varchar(100) NOT NULL,
  bio text NOT NULL DEFAULT '', region varchar(100) NOT NULL DEFAULT '', crops varchar(150) NOT NULL DEFAULT '',
  suspended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS community_topics (
  id varchar(50) PRIMARY KEY, name varchar(100) NOT NULL, description varchar(250) NOT NULL DEFAULT ''
);
INSERT INTO community_topics(id,name,description) VALUES
  ('cultivation','Kỹ thuật canh tác','Cùng nhau chăm cây, chăm đất'),
  ('plant-health','Sâu bệnh','Trao đổi tình trạng cây trồng'),
  ('harvest','Mùa vụ','Chuyện vườn và những mùa thu hoạch'),
  ('market','Giá nông sản','Thông tin thị trường từ cộng đồng'),
  ('supplies','Vật tư','Kinh nghiệm lựa chọn và sử dụng vật tư') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS community_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), author_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES agrilink_organizations(id), body text NOT NULL CHECK(length(body) BETWEEN 5 AND 5000),
  kind varchar(20) NOT NULL CHECK(kind IN ('question','experience','market','announcement')),
  state varchar(20) NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','hidden','deleted')),
  crop varchar(80) NOT NULL DEFAULT '', region varchar(100) NOT NULL DEFAULT '',
  source varchar(250) NOT NULL DEFAULT '', observed_at varchar(80) NOT NULL DEFAULT '',
  topics text[] NOT NULL DEFAULT '{}', request_id uuid NOT NULL,
  helpful_comment_id uuid, moderation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(author_id, request_id)
);
CREATE INDEX IF NOT EXISTS community_feed_idx ON community_posts(state,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS community_author_idx ON community_posts(author_id,state);
CREATE INDEX IF NOT EXISTS community_topic_idx ON community_posts USING gin(topics);
CREATE TABLE IF NOT EXISTS community_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL REFERENCES community_posts(id),
  author_id uuid NOT NULL REFERENCES users(id), parent_id uuid REFERENCES community_comments(id),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), request_id uuid NOT NULL,
  state varchar(20) NOT NULL DEFAULT 'published' CHECK(state IN ('published','hidden','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(author_id,request_id)
);
CREATE INDEX IF NOT EXISTS community_comments_post_idx ON community_comments(post_id,created_at,id);
CREATE TABLE IF NOT EXISTS community_actions (
  user_id uuid NOT NULL REFERENCES users(id), post_id uuid NOT NULL REFERENCES community_posts(id),
  kind varchar(20) NOT NULL CHECK(kind IN ('like','bookmark','subscription')),
  PRIMARY KEY(user_id,post_id,kind)
);
CREATE TABLE IF NOT EXISTS community_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id), blocked_id uuid NOT NULL REFERENCES users(id),
  PRIMARY KEY(blocker_id,blocked_id), CHECK(blocker_id <> blocked_id)
);
CREATE TABLE IF NOT EXISTS community_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
  post_id uuid REFERENCES community_posts(id), bytes bytea NOT NULL,
  mime varchar(30) NOT NULL DEFAULT 'image/webp', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_media_post_idx ON community_media(post_id);
CREATE TABLE IF NOT EXISTS community_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reporter_id uuid NOT NULL REFERENCES users(id),
  post_id uuid NOT NULL REFERENCES community_posts(id), comment_id uuid REFERENCES community_comments(id),
  reason text NOT NULL, state varchar(20) NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS community_open_report_idx ON community_reports(reporter_id,post_id,COALESCE(comment_id,post_id)) WHERE state='open';
CREATE TABLE IF NOT EXISTS community_moderation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES community_reports(id),
  actor_id uuid NOT NULL REFERENCES users(id), action varchar(30) NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES users(id),
  actor_id uuid NOT NULL REFERENCES users(id), post_id uuid REFERENCES community_posts(id),
  comment_id uuid REFERENCES community_comments(id), kind varchar(30) NOT NULL,
  event_key text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(recipient_id,event_key)
);
CREATE INDEX IF NOT EXISTS community_notification_recipient_idx ON community_notifications(recipient_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agrilink_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
