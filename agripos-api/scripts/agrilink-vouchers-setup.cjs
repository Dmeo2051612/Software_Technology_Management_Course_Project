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
        join(__dirname, '../src/migrations/create-agrilink-vouchers.sql'),
        'utf8',
      ),
    );
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname='agrilink_business'",
    );
    if (role.rowCount) {
      // Sửa/huỷ/hoàn thành đơn ở agrilink-manage chạy dưới RLS: cần đọc voucher
      // và hoàn lượt trong phạm vi đại lý đang chọn.
      const scope = "organization_id=NULLIF(current_setting('app.organization_id',true),'')::uuid";
      for (const t of ['agrilink_vouchers', 'agrilink_voucher_claims']) {
        await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
        await client.query(`DROP POLICY IF EXISTS organization_scope ON ${t}`);
        await client.query(
          `CREATE POLICY organization_scope ON ${t} TO agrilink_business USING (${scope}) WITH CHECK (${scope})`,
        );
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO agrilink_business`);
      }
    } else {
      console.warn('Role agrilink_business missing — run community:setup first; voucher RLS/grants skipped.');
    }
    await client.query('COMMIT');
    console.log('AgriLink voucher schema is ready.');
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
