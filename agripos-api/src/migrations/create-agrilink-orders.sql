-- AgriLink multi-item orders. Additive and idempotent. Run after create-marketplace.sql.
-- Run ONLY via `npm run agrilink:setup` (wraps this in one transaction for the
-- ON COMMIT DROP temp table below, and applies the RLS policies/GRANTs) — never `psql -f`.
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS logo_url varchar(500) NOT NULL DEFAULT '';
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS opening_hours varchar(200) NOT NULL DEFAULT '';
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS fulfillment_options text[] NOT NULL DEFAULT '{pickup,at_dealer}';
ALTER TABLE agrilink_offers ALTER COLUMN price DROP NOT NULL;
ALTER TABLE agrilink_offers ALTER COLUMN price DROP DEFAULT;
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS commodity_type varchar(30);
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- existing sale offers always used the POS price
UPDATE agrilink_offers SET price = NULL WHERE kind = 'sale' AND price = 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'pos';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "agrilinkOrderId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS orders_agrilink_order_uq ON orders("agrilinkOrderId");
ALTER TABLE weighing_slips ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'weighing';
ALTER TABLE weighing_slips ADD COLUMN IF NOT EXISTS "agrilinkOrderId" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS weighing_slips_agrilink_order_uq ON weighing_slips("agrilinkOrderId");

CREATE TABLE IF NOT EXISTS agrilink_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES agrilink_organizations(id),
  code varchar(30) NOT NULL,
  "requesterId" uuid NOT NULL REFERENCES users(id),
  kind varchar(10) NOT NULL CHECK (kind IN ('buy','sell')),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','delivering','completed','rejected','cancelled')),
  fulfillment varchar(20) NOT NULL CHECK (fulfillment IN ('pickup','delivery','at_dealer')),
  address varchar(250) NOT NULL DEFAULT '', note varchar(1000) NOT NULL DEFAULT '',
  "contactName" varchar(150) NOT NULL, "contactPhone" varchar(30) NOT NULL,
  "estimatedTotal" numeric(15,2) NOT NULL DEFAULT 0, "finalTotal" numeric(15,2),
  "rejectReason" varchar(500), "cancelReason" varchar(500), "cancelledBy" varchar(10),
  "posRefType" varchar(20), "posRefId" uuid,
  "confirmedAt" timestamp, "completedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(), "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_orders_code_uq ON agrilink_orders("organizationId", code);
CREATE INDEX IF NOT EXISTS agrilink_orders_status_idx ON agrilink_orders("organizationId", status, "createdAt");
CREATE INDEX IF NOT EXISTS agrilink_orders_requester_idx ON agrilink_orders("requesterId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_agrilink_order_fk') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_agrilink_order_fk FOREIGN KEY ("agrilinkOrderId") REFERENCES agrilink_orders(id);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'weighing_slips_agrilink_order_fk') THEN
    ALTER TABLE weighing_slips ADD CONSTRAINT weighing_slips_agrilink_order_fk FOREIGN KEY ("agrilinkOrderId") REFERENCES agrilink_orders(id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agrilink_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "orderId" uuid NOT NULL REFERENCES agrilink_orders(id) ON DELETE CASCADE,
  "offerId" uuid NOT NULL REFERENCES agrilink_offers(id),
  "productId" uuid REFERENCES products(id), "commodityType" varchar(30),
  "itemName" varchar(180) NOT NULL, unit varchar(50) NOT NULL,
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0), "unitPrice" numeric(15,2) NOT NULL CHECK ("unitPrice" >= 0),
  "finalQuantity" numeric(15,3), "finalUnitPrice" numeric(15,2)
);
CREATE INDEX IF NOT EXISTS agrilink_order_items_order_idx ON agrilink_order_items("orderId");

CREATE TABLE IF NOT EXISTS agrilink_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "orderId" uuid NOT NULL REFERENCES agrilink_orders(id) ON DELETE CASCADE,
  "fromStatus" varchar(20), "toStatus" varchar(20) NOT NULL,
  "actorId" uuid NOT NULL REFERENCES users(id), "actorName" varchar(150) NOT NULL,
  note varchar(500) NOT NULL DEFAULT '', "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agrilink_order_events_order_idx ON agrilink_order_events("orderId", "createdAt");

CREATE TABLE IF NOT EXISTS agrilink_customer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL,
  "userId" uuid NOT NULL REFERENCES users(id),
  "customerId" uuid REFERENCES customers(id), "farmerId" uuid REFERENCES farmers(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_customer_links_uq ON agrilink_customer_links("organizationId", "userId");

-- Migrate legacy single-item trade requests (keeps the request id as the order id).
CREATE TEMP TABLE _al_mig ON COMMIT DROP AS
  SELECT r.*, u."fullName" AS full_name, COALESCE(u.phone, '') AS phone, f.product_id, f.commodity_type
  FROM agrilink_trade_requests r
  JOIN users u ON u.id = r.requester_id
  JOIN agrilink_offers f ON f.id = r.offer_id
  WHERE NOT EXISTS (SELECT 1 FROM agrilink_orders a WHERE a.id = r.id);
INSERT INTO agrilink_orders(id,"organizationId",code,"requesterId",kind,status,fulfillment,address,note,
  "contactName","contactPhone","estimatedTotal","createdAt","updatedAt")
SELECT id, organization_id, 'AL-MIG-' || substr(id::text,1,8), requester_id, kind,
  CASE status WHEN 'accepted' THEN 'confirmed' ELSE status END,
  fulfillment, address, note, left(full_name,150), phone, round(quantity*unit_price), created_at, updated_at
FROM _al_mig;
INSERT INTO agrilink_order_items("organizationId","orderId","offerId","productId","commodityType","itemName",unit,quantity,"unitPrice")
SELECT organization_id, id, offer_id, product_id, commodity_type, item_name, unit, quantity, unit_price FROM _al_mig;
INSERT INTO agrilink_order_events("organizationId","orderId","fromStatus","toStatus","actorId","actorName",note,"createdAt")
SELECT organization_id, id, NULL, CASE status WHEN 'accepted' THEN 'confirmed' ELSE status END, requester_id, left(full_name,150), 'Chuyển từ yêu cầu giao dịch cũ', created_at FROM _al_mig;
