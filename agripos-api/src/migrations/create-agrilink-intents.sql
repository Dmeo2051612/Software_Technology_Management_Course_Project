-- AgriLink matching intents. Run after agri:setup; safe to rerun.
-- Generic coffee defaults to beans for the initial rule provider; growers can edit the confirmed crop.
INSERT INTO agri_crop_aliases(crop_id,alias_norm)
SELECT id,'ca phe' FROM agri_crops WHERE code='ca-phe-nhan'
ON CONFLICT(alias_norm) DO UPDATE SET crop_id=excluded.crop_id;

CREATE TABLE IF NOT EXISTS agrilink_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id),
  side varchar(4) NOT NULL CHECK (side IN ('sell','buy')),
  status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','expired','cancelled')),
  raw_text varchar(1000) NOT NULL,
  crop_id uuid REFERENCES agri_crops(id),
  product_query varchar(200),
  quantity_kg numeric(15,3) CHECK (quantity_kg > 0),
  quantity_text varchar(60) NOT NULL DEFAULT '',
  province_code varchar(40) NOT NULL REFERENCES admin_provinces(code),
  commune_code varchar(40) REFERENCES admin_communes(code),
  window_start date NOT NULL,
  window_end date NOT NULL CHECK (window_end >= window_start),
  expected_price_per_kg numeric(15,2),
  fulfillment_pref varchar(8) NOT NULL DEFAULT 'any' CHECK (fulfillment_pref IN ('pickup','dropoff','any')),
  note varchar(500) NOT NULL DEFAULT '',
  parser varchar(10) NOT NULL DEFAULT 'rules',
  parse_confidence numeric(4,3) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((side='sell' AND crop_id IS NOT NULL AND quantity_kg IS NOT NULL) OR
    (side='buy' AND product_query IS NOT NULL AND length(trim(product_query)) >= 2))
);
CREATE INDEX IF NOT EXISTS agrilink_intents_side_idx ON agrilink_intents(side,status,crop_id);
CREATE INDEX IF NOT EXISTS agrilink_intents_requester_idx ON agrilink_intents(requester_id,created_at DESC);
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS max_quantity_kg numeric(15,3) CHECK (max_quantity_kg > 0);
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS valid_until date;
