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
        join(__dirname, '../src/migrations/create-agrilink-trust.sql'),
        'utf8',
      ),
    );
    const role = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname='agrilink_business'",
    );
    if (role.rowCount)
      await client.query(
        'GRANT SELECT ON agrilink_order_ratings, agrilink_dealer_verifications TO agrilink_business',
      );
    await client.query('COMMIT');
    console.log('AgriLink trust schema is ready.');
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
