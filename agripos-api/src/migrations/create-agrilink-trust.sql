-- AgriLink trust signals. Run after agrilink:booking-setup.
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS price_updated_at timestamptz;
UPDATE agrilink_offers SET price_updated_at=updated_at WHERE price_updated_at IS NULL;
ALTER TABLE agrilink_offers ALTER COLUMN price_updated_at SET DEFAULT now();
ALTER TABLE agrilink_offers ALTER COLUMN price_updated_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS agrilink_buy_price_age_idx ON agrilink_offers(price_updated_at) WHERE kind='buy' AND active;

CREATE TABLE IF NOT EXISTS agri_crop_market_instruments (
  crop_id uuid NOT NULL REFERENCES agri_crops(id),
  instrument varchar(80) NOT NULL,
  province_code varchar(40) REFERENCES admin_provinces(code),
  PRIMARY KEY(crop_id,instrument)
);
INSERT INTO agri_crop_market_instruments(crop_id,instrument,province_code)
SELECT c.id,v.instrument,v.province_code FROM (VALUES
  ('ca-phe-nhan','domestic_coffee_dak_lak','dak-lak'),
  ('ca-phe-nhan','domestic_coffee_dak_nong','lam-dong'),
  ('ca-phe-nhan','domestic_coffee_gia_lai','gia-lai'),
  ('ca-phe-nhan','domestic_coffee_kon_tum','quang-ngai'),
  ('ca-phe-nhan','domestic_coffee_lam_dong','lam-dong'),
  ('ho-tieu','domestic_pepper_dak_lak','dak-lak'),
  ('ho-tieu','domestic_pepper_dak_nong','lam-dong'),
  ('ho-tieu','domestic_pepper_gia_lai','gia-lai'),
  ('ho-tieu','domestic_pepper_brvt','ho-chi-minh')
) v(code,instrument,province_code) JOIN agri_crops c ON c.code=v.code
ON CONFLICT(crop_id,instrument) DO UPDATE SET province_code=excluded.province_code;

CREATE TABLE IF NOT EXISTS agrilink_order_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES agrilink_orders(id),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  rater_id uuid NOT NULL REFERENCES users(id),
  stars smallint NOT NULL CHECK(stars BETWEEN 1 AND 5),
  accurate_weight boolean, paid_on_time boolean, on_time boolean, as_described boolean,
  comment varchar(500) NOT NULL DEFAULT '',
  hidden boolean NOT NULL DEFAULT false, hidden_reason varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agrilink_ratings_public_idx ON agrilink_order_ratings(organization_id,created_at DESC) WHERE NOT hidden;

CREATE TABLE IF NOT EXISTS agrilink_dealer_verifications (
  organization_id uuid PRIMARY KEY REFERENCES agrilink_organizations(id),
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
  legal_name varchar(200) NOT NULL, tax_code varchar(20) NOT NULL,
  business_address varchar(300) NOT NULL,
  submitted_by uuid NOT NULL REFERENCES users(id), submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  note varchar(300) NOT NULL DEFAULT ''
);
