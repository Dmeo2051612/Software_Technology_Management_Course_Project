require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});
async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      readFileSync(
        join(__dirname, '../src/migrations/create-agrilink-offers-booking.sql'),
        'utf8',
      ),
    );
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname='agrilink_business'",
    );
    if (role.rowCount) {
      await client.query('GRANT SELECT, UPDATE ON agrilink_service_bookings, agrilink_intents, agrilink_intent_offers TO agrilink_business');
      for (const table of ['agrilink_service_bookings', 'agrilink_intents', 'agrilink_intent_offers'])
        await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query('DROP POLICY IF EXISTS agrilink_service_bookings_tenant ON agrilink_service_bookings');
      await client.query(`CREATE POLICY agrilink_service_bookings_tenant ON agrilink_service_bookings TO agrilink_business
        USING (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)
        WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)`);
      await client.query('DROP POLICY IF EXISTS agrilink_intents_dealer_order ON agrilink_intents');
      await client.query(`CREATE POLICY agrilink_intents_dealer_order ON agrilink_intents TO agrilink_business
        USING (EXISTS (SELECT 1 FROM agrilink_orders o WHERE o."intentId"=agrilink_intents.id AND o."organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid))
        WITH CHECK (EXISTS (SELECT 1 FROM agrilink_orders o WHERE o."intentId"=agrilink_intents.id AND o."organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid))`);
      await client.query('DROP POLICY IF EXISTS agrilink_intent_offers_dealer ON agrilink_intent_offers');
      await client.query(`CREATE POLICY agrilink_intent_offers_dealer ON agrilink_intent_offers TO agrilink_business
        USING (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)
        WITH CHECK (organization_id = NULLIF(current_setting('app.organization_id',true),'')::uuid)`);
    }
    await client.query('COMMIT');
    console.log('AgriLink booking schema is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
