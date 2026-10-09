/* Explicit, transactional upgrade for AgriLink orders. Run after marketplace-setup. */
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
const scoped = [
  'agrilink_orders',
  'agrilink_order_items',
  'agrilink_order_events',
  'agrilink_customer_links',
];
const scope = `"organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid`;
async function main() {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query(
      readFileSync(
        join(__dirname, '../src/migrations/create-agrilink-orders.sql'),
        'utf8',
      ),
    );
    const role = await client.query(
      `SELECT 1 FROM pg_roles WHERE rolname='agrilink_business'`,
    );
    if (role.rowCount) {
      for (const t of scoped) {
        await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await client.query(`DROP POLICY IF EXISTS organization_scope ON ${t}`);
        await client.query(
          `CREATE POLICY organization_scope ON ${t} TO agrilink_business USING (${scope}) WITH CHECK (${scope})`,
        );
        await client.query(
          `GRANT SELECT,INSERT,UPDATE,DELETE ON ${t} TO agrilink_business`,
        );
      }
      await client.query(
        'GRANT INSERT ON community_notifications TO agrilink_business',
      );
    } else {
      console.warn(
        'Role agrilink_business missing — run community:setup first; RLS skipped.',
      );
    }
    await client.query('COMMIT');
    console.log('AgriLink orders schema is ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
