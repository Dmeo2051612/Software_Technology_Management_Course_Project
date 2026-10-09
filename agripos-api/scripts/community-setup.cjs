/* Explicit, transactional upgrade. Never imports/starts the HTTP application. */
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const legacy = '00000000-0000-4000-8000-000000000001';
const tables = [
  'batch_expenses',
  'categories',
  'commodity_batches',
  'commodity_sales',
  'consignment_items',
  'customer_return_items',
  'customer_returns',
  'customers',
  'dealer_debt_payments',
  'dealer_debts',
  'dealers',
  'debt_payments',
  'debts',
  'farmer_debts',
  'farmers',
  'hamlets',
  'historical_reports',
  'inventory_adjustment_items',
  'inventory_adjustments',
  'inventory_ledger',
  'invoice_settings',
  'opening_balance_items',
  'opening_balances',
  'order_items',
  'orders',
  'product_batches',
  'products',
  'purchase_items',
  'purchase_orders',
  'seasons',
  'stock_movements',
  'store_settings',
  'suppliers',
  'system_settings',
  'transactions',
  'weighing_slips',
];
const databaseArg = process.argv.find((a) => a.startsWith('--database='));
const client = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: databaseArg?.slice(11) || process.env.DB_DATABASE,
});
const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
async function main() {
  await client.connect();
  await client.query('BEGIN');
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS unaccent');
    await client.query(
      readFileSync(
        join(__dirname, '../src/migrations/create-community.sql'),
        'utf8',
      ),
    );
    const done = (
      await client.query(
        "SELECT 1 FROM agrilink_migrations WHERE name='community-tenancy-v1'",
      )
    ).rowCount;
    if (done) {
      await client.query('COMMIT');
      console.log('Community migration already applied.');
      return;
    }
    const stores = await client.query('SELECT "storeName" FROM store_settings');
    if (stores.rowCount > 1)
      throw new Error(
        'Multiple legacy stores found. Map ownership before migrating.',
      );
    await client.query(
      'INSERT INTO agrilink_organizations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [legacy, stores.rows[0]?.storeName || 'AgriPOS'],
    );
    await client.query(
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS "organizationId" uuid',
    );
    await client.query(
      'UPDATE users SET "organizationId"=$1 WHERE role<>\'farmer\' AND "organizationId" IS NULL',
      [legacy],
    );
    await client.query(`INSERT INTO agrilink_memberships(user_id,organization_id,can_publish)
      SELECT id,"organizationId",role='owner' FROM users WHERE "organizationId" IS NOT NULL ON CONFLICT DO NOTHING`);
    await client.query(
      `INSERT INTO community_profiles(user_id,display_name) SELECT id,left("fullName",100) FROM users ON CONFLICT DO NOTHING`,
    );
    await client.query(
      `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='agrilink_business') THEN CREATE ROLE agrilink_business NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`,
    );
    const [{ current_user: dbUser }] = (
      await client.query('SELECT current_user')
    ).rows;
    await client.query(`GRANT agrilink_business TO ${quote(dbUser)}`);
    await client.query('GRANT USAGE ON SCHEMA public TO agrilink_business');
    await client.query(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agrilink_business',
    );
    const before = {};
    for (const table of tables) {
      const exists = (
        await client.query('SELECT to_regclass($1) AS name', [table])
      ).rows[0].name;
      if (!exists)
        throw new Error(
          `Missing legacy table ${table}. Initialize the existing schema first.`,
        );
      before[table] = (
        await client.query(`SELECT count(*)::int AS n FROM ${quote(table)}`)
      ).rows[0].n;
      await client.query(
        `ALTER TABLE ${quote(table)} ADD COLUMN IF NOT EXISTS "organizationId" uuid NOT NULL DEFAULT '${legacy}'::uuid`,
      );
      await client.query(
        `ALTER TABLE ${quote(table)} ALTER COLUMN "organizationId" SET DEFAULT COALESCE(NULLIF(current_setting('app.organization_id',true),'')::uuid,'${legacy}'::uuid)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${quote('tenant_scope_' + table)} ON ${quote(table)} ("organizationId")`,
      );
      // Replace business-key uniqueness with uniqueness inside each organization.
      const uniques = await client.query(
        `SELECT conname, array_agg(a.attname ORDER BY k.ord) AS columns FROM pg_constraint c
        CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(num,ord)
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num
        WHERE c.conrelid=$1::regclass AND c.contype='u' GROUP BY c.conname`,
        [table],
      );
      for (const constraint of uniques.rows) {
        if (constraint.columns.includes('organizationId')) continue;
        await client.query(
          `ALTER TABLE ${quote(table)} DROP CONSTRAINT ${quote(constraint.conname)}`,
        );
        const cols = ['organizationId', ...constraint.columns]
          .map(quote)
          .join(',');
        await client.query(
          `CREATE UNIQUE INDEX ${quote('tenant_' + table + '_' + constraint.columns.join('_'))} ON ${quote(table)} (${cols})`,
        );
      }
      if (table === 'system_settings') {
        const keys = (
          await client.query(
            "SELECT conname FROM pg_constraint WHERE conrelid='system_settings'::regclass AND contype='p'",
          )
        ).rows;
        for (const key of keys)
          await client.query(
            `ALTER TABLE system_settings DROP CONSTRAINT ${quote(key.conname)}`,
          );
        await client.query(
          'ALTER TABLE system_settings ADD PRIMARY KEY("organizationId",key)',
        );
      }
      await client.query(
        `ALTER TABLE ${quote(table)} ENABLE ROW LEVEL SECURITY`,
      );
      await client.query(
        `DROP POLICY IF EXISTS organization_scope ON ${quote(table)}`,
      );
      await client.query(`CREATE POLICY organization_scope ON ${quote(table)} TO agrilink_business
        USING ("organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid)
        WITH CHECK ("organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid)`);
      await client.query(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ${quote(table)} TO agrilink_business`,
      );
    }
    // RLS also restricts staff administration and token creation inside /auth/register.
    await client.query(`ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      CREATE POLICY organization_staff ON users TO agrilink_business USING ("organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK ("organizationId"=NULLIF(current_setting('app.organization_id',true),'')::uuid);
      GRANT SELECT,INSERT,UPDATE ON users TO agrilink_business;
      ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
      CREATE POLICY organization_tokens ON refresh_tokens TO agrilink_business USING (EXISTS(SELECT 1 FROM users u WHERE u.id="userId")) WITH CHECK (EXISTS(SELECT 1 FROM users u WHERE u.id="userId"));
      GRANT SELECT,INSERT,UPDATE ON refresh_tokens TO agrilink_business;
      ALTER TABLE agrilink_memberships ENABLE ROW LEVEL SECURITY;
      CREATE POLICY own_memberships ON agrilink_memberships TO agrilink_business USING (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid) WITH CHECK (organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid);
      GRANT SELECT,INSERT ON agrilink_memberships TO agrilink_business;
      GRANT SELECT ON agrilink_organizations, commodity_snapshots, scraper_runs TO agrilink_business`);
    // Database foreign keys bypass RLS. Enforce same-organization links as well.
    await client.query(`CREATE OR REPLACE FUNCTION agrilink_check_reference() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE target uuid; valid boolean;
      BEGIN
        target := NULLIF(to_jsonb(NEW)->>TG_ARGV[0],'')::uuid;
        IF target IS NULL THEN RETURN NEW; END IF;
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I=$1 AND "organizationId"=$2)',TG_ARGV[1],TG_ARGV[2]) INTO valid USING target,NEW."organizationId";
        IF NOT valid THEN RAISE EXCEPTION 'Reference outside organization' USING ERRCODE='23503'; END IF;
        RETURN NEW;
      END $$`);
    const fks =
      await client.query(`SELECT c.conname, c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,
      a.attname AS field, b.attname AS target_field FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
      WHERE c.contype='f' AND array_length(c.conkey,1)=1`);
    for (const fk of fks.rows) {
      if (
        !tables.includes(fk.source) ||
        ![...tables, 'users'].includes(fk.target)
      )
        continue;
      await client.query(
        `CREATE TRIGGER ${quote('org_' + fk.conname)} BEFORE INSERT OR UPDATE ON ${quote(fk.source)} FOR EACH ROW EXECUTE FUNCTION agrilink_check_reference('${fk.field}','${fk.target}','${fk.target_field}')`,
      );
    }
    for (const table of tables) {
      const after = (
        await client.query(`SELECT count(*)::int AS n FROM ${quote(table)}`)
      ).rows[0].n;
      if (before[table] !== after)
        throw new Error(`Row count changed: ${table}`);
    }
    await client.query(
      "INSERT INTO agrilink_migrations(name) VALUES('community-tenancy-v1')",
    );
    await client.query('COMMIT');
    console.log(
      `Community + tenant isolation installed. Preserved row counts across ${tables.length} business tables.`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
