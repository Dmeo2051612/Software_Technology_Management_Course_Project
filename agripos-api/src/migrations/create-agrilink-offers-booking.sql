-- Matching offers and race-safe service bookings. Run through agrilink:booking-setup.
CREATE TABLE IF NOT EXISTS agrilink_intent_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES agrilink_intents(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','withdrawn','expired')),
  price_per_kg numeric(15,2), products jsonb,
  fulfillment varchar(10) NOT NULL CHECK (fulfillment IN ('pickup','delivery','at_dealer')),
  scheduled_date date, scheduled_session varchar(10) CHECK (scheduled_session IN ('morning','afternoon')),
  fee_per_kg numeric(15,2) NOT NULL DEFAULT 0, message varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agrilink_intent_offers_pending_uq ON agrilink_intent_offers(intent_id,organization_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS agrilink_service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES agrilink_dealer_services(id),
  organization_id uuid NOT NULL REFERENCES agrilink_organizations(id),
  booking_date date NOT NULL, session varchar(10) NOT NULL CHECK (session IN ('morning','afternoon')),
  agrilink_order_id uuid REFERENCES agrilink_orders(id),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agrilink_service_bookings_active_idx ON agrilink_service_bookings(service_id,booking_date,session) WHERE status='active';
ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "intentId" uuid REFERENCES agrilink_intents(id);
ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "scheduledDate" date;
ALTER TABLE agrilink_orders ADD COLUMN IF NOT EXISTS "scheduledSession" varchar(10);
ALTER TABLE agrilink_order_items ADD COLUMN IF NOT EXISTS "cropId" uuid REFERENCES agri_crops(id);
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='agrilink_intents'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%status%' LOOP
    EXECUTE format('ALTER TABLE agrilink_intents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE agrilink_intents ADD CONSTRAINT agrilink_intents_status_matching_check CHECK (status IN ('open','closed','expired','cancelled','matched'));
