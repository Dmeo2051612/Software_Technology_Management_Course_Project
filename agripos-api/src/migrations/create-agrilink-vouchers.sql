-- AgriLink dealer vouchers (đợt D). Run after agrilink:messaging-setup.
CREATE TABLE IF NOT EXISTS agrilink_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  title varchar(80) NOT NULL,
  discount_type varchar(10) NOT NULL CHECK (discount_type IN ('amount','percent')),
  value numeric(15,0) NOT NULL CHECK (value > 0),
  max_discount numeric(15,0) CHECK (max_discount IS NULL OR max_discount > 0),
  min_order numeric(15,0) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  quantity int NOT NULL CHECK (quantity > 0),
  used_count int NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agrilink_vouchers_used_check CHECK (used_count >= 0 AND used_count <= quantity),
  CONSTRAINT agrilink_vouchers_dates_check CHECK (ends_at > starts_at),
  CONSTRAINT agrilink_vouchers_percent_check CHECK (discount_type='amount' OR (value <= 90 AND max_discount IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS agrilink_vouchers_org_idx ON agrilink_vouchers(organization_id, ends_at);

CREATE TABLE IF NOT EXISTS agrilink_voucher_claims (
  voucher_id uuid NOT NULL REFERENCES agrilink_vouchers(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  order_id uuid REFERENCES agrilink_orders(id),
  used_at timestamptz,
  PRIMARY KEY (voucher_id, user_id)
);
CREATE INDEX IF NOT EXISTS agrilink_voucher_claims_user_idx ON agrilink_voucher_claims(user_id);

ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "voucherId" uuid REFERENCES agrilink_vouchers(id);
ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "voucherSnapshot" jsonb;
ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "discountAmount" numeric(15,0) NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS agrilink_orders_voucher_idx ON agrilink_orders("voucherId") WHERE "voucherId" IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agrilink_orders_discount_check') THEN
    ALTER TABLE agrilink_orders ADD CONSTRAINT agrilink_orders_discount_check CHECK ("discountAmount" >= 0);
  END IF;
END $$;
