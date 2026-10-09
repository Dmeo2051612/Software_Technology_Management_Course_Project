-- AgriLink storefront and on-platform transaction requests. Additive and idempotent.
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS address varchar(250) NOT NULL DEFAULT '';
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS phone varchar(30) NOT NULL DEFAULT '';
ALTER TABLE agrilink_organizations ADD COLUMN IF NOT EXISTS marketplace_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS agrilink_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  kind varchar(10) NOT NULL CHECK (kind IN ('sale','buy')),
  product_id uuid REFERENCES products(id),
  title varchar(180) NOT NULL DEFAULT '',
  unit varchar(50) NOT NULL DEFAULT '',
  price numeric(15,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='sale' AND product_id IS NOT NULL) OR (kind='buy' AND product_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_sale_product_idx ON agrilink_offers(organization_id,product_id) WHERE kind='sale';
CREATE INDEX IF NOT EXISTS agrilink_offer_directory_idx ON agrilink_offers(organization_id,kind,active);

CREATE TABLE IF NOT EXISTS agrilink_trade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  offer_id uuid NOT NULL REFERENCES agrilink_offers(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  kind varchar(10) NOT NULL CHECK (kind IN ('buy','sell')),
  quantity numeric(15,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(15,2) NOT NULL CHECK (unit_price >= 0),
  item_name varchar(180) NOT NULL,
  unit varchar(50) NOT NULL,
  fulfillment varchar(20) NOT NULL CHECK (fulfillment IN ('pickup','delivery','at_dealer')),
  address varchar(250) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agrilink_trade_org_idx ON agrilink_trade_requests(organization_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS agrilink_trade_requester_idx ON agrilink_trade_requests(requester_id,created_at DESC);
