-- AgriLink chat, complaints and support. Run after agrilink:listings-setup.
CREATE TABLE IF NOT EXISTS agrilink_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(10) NOT NULL CHECK (kind IN ('chat','complaint','support')),
  buyer_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES agrilink_organizations(id),
  order_id uuid REFERENCES agrilink_orders(id),
  code varchar(20) NOT NULL DEFAULT '',
  status varchar(15) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','dealer_replied','escalated','resolved','answered','closed')),
  category varchar(30),
  subject varchar(180) NOT NULL DEFAULT '',
  buyer_wish varchar(20),
  dealer_proposal varchar(20),
  blocked_by_buyer boolean NOT NULL DEFAULT false,
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolution varchar(20) CHECK (resolution IS NULL OR resolution IN ('agreed','buyer_favored','dealer_favored','settled')),
  resolution_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='support') = (organization_id IS NULL)),
  CHECK (kind <> 'complaint' OR order_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_chat_pair_idx ON agrilink_threads(buyer_id, organization_id) WHERE kind='chat';
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_open_complaint_idx ON agrilink_threads(order_id) WHERE kind='complaint' AND status <> 'resolved';
CREATE INDEX IF NOT EXISTS agrilink_threads_buyer_idx ON agrilink_threads(buyer_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS agrilink_threads_org_idx ON agrilink_threads(organization_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS agrilink_threads_admin_idx ON agrilink_threads(kind, status, last_message_at DESC);
CREATE SEQUENCE IF NOT EXISTS agrilink_complaint_seq;
CREATE SEQUENCE IF NOT EXISTS agrilink_support_seq;

CREATE TABLE IF NOT EXISTS agrilink_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES agrilink_threads(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id),
  sender_side varchar(8) NOT NULL CHECK (sender_side IN ('buyer','dealer','admin','system')),
  body varchar(2000) NOT NULL DEFAULT '',
  images jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images)='array' AND jsonb_array_length(images) <= 4),
  order_id uuid REFERENCES agrilink_orders(id),
  created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp())
);
CREATE INDEX IF NOT EXISTS agrilink_messages_thread_idx ON agrilink_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agrilink_thread_reads (
  thread_id uuid NOT NULL REFERENCES agrilink_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- Con trỏ "tin mới hơn" của web có độ chính xác mili-giây (Date của JS);
-- lưu thời điểm tin nhắn cùng độ chính xác để không trả lại tin cũ mỗi lần hỏi.
ALTER TABLE agrilink_messages ALTER COLUMN created_at SET DEFAULT date_trunc('milliseconds', clock_timestamp());
UPDATE agrilink_messages SET created_at=date_trunc('milliseconds', created_at) WHERE created_at <> date_trunc('milliseconds', created_at);
