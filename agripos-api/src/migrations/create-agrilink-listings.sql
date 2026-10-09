-- AgriLink product listings: AgriLink-only details + timed sale price. Run after agrilink:trust-setup.
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS description varchar(2000) NOT NULL DEFAULT '';
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS images jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS sale_price numeric(15,2);
ALTER TABLE agrilink_offers ADD COLUMN IF NOT EXISTS sale_ends_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agrilink_offers_sale_price_check') THEN
    ALTER TABLE agrilink_offers ADD CONSTRAINT agrilink_offers_sale_price_check CHECK (sale_price IS NULL OR sale_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agrilink_offers_sale_ends_check') THEN
    ALTER TABLE agrilink_offers ADD CONSTRAINT agrilink_offers_sale_ends_check CHECK (sale_price IS NULL OR sale_ends_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='agrilink_offers_images_check') THEN
    ALTER TABLE agrilink_offers ADD CONSTRAINT agrilink_offers_images_check CHECK (jsonb_typeof(images)='array' AND jsonb_array_length(images) <= 6);
  END IF;
END $$;
