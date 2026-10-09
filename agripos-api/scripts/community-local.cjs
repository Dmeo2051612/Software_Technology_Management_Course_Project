// Development-only backup/clone/demo utilities; no production seeding.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const bcrypt = require('bcrypt');
const mode = process.argv[2];
const base = process.env.DB_DATABASE;
const databaseArg = process.argv.find((value) =>
  value.startsWith('--database='),
);
const config = {
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: databaseArg?.slice(11) || base,
  connectionTimeoutMillis: 5000,
};
if (
  process.env.NODE_ENV === 'production' ||
  !['127.0.0.1', 'localhost'].includes(config.host)
)
  throw new Error('This utility only operates on local development databases.');
const client = new Client(config);
async function main() {
  await client.connect();
  if (mode === 'inspect') {
    console.log(
      (await client.query('SELECT current_database(),current_user,version()'))
        .rows,
    );
    console.log(
      (await client.query('SELECT count(*)::int AS users FROM users')).rows,
    );
  } else if (mode === 'backup') {
    const file = resolve(
      '../tmp/agripos-before-community-' + Date.now() + '.dump',
    );
    execFileSync(
      resolve('../tmp/postgresql-16.15/pgsql/bin/pg_dump.exe'),
      [
        '-h',
        config.host,
        '-p',
        String(config.port),
        '-U',
        config.user,
        '-d',
        base,
        '-Fc',
        '-f',
        file,
      ],
      {
        env: { ...process.env, PGPASSWORD: config.password },
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    console.log('Backup:', file);
  } else if (mode === 'clone') {
    const target = 'agripos_community_verify';
    const exists = (
      await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [target])
    ).rowCount;
    if (exists)
      throw new Error(
        'Verification database already exists; refusing to overwrite it.',
      );
    // The app must be stopped; no connections are terminated by this script.
    await client.end();
    const admin = new Client({ ...config, database: 'postgres' });
    await admin.connect();
    try {
      await admin.query(
        `CREATE DATABASE "${target}" TEMPLATE "${base.replaceAll('"', '""')}"`,
      );
      console.log('Created verification database:', target);
    } finally {
      await admin.end();
    }
  } else if (mode === 'demo') {
    const password = process.env.SEED_FARMER_PASSWORD;
    if (!password)
      throw new Error('Set SEED_FARMER_PASSWORD for local-only demo accounts.');
    const hash = await bcrypt.hash(password, 10);
    const orgId = '00000000-0000-4000-8000-000000000002';
    await client.query(
      "INSERT INTO agrilink_organizations(id,name,bio,region) VALUES($1,'Đại lý An Phú · Demo','Hồ sơ mẫu để trải nghiệm trao đổi giữa đại lý và nông dân.','Đồng bằng sông Cửu Long') ON CONFLICT DO NOTHING",
      [orgId],
    );
    const people = [
      ['farmer-demo@agrilink.vn', 'Nguyễn Minh An · Demo', 'farmer', null],
      ['dealer-demo@agrilink.vn', 'Đại diện An Phú · Demo', 'owner', orgId],
      ['moderator@agrilink.vn', 'Quản trị AgriLink · Local', 'farmer', null],
    ];
    const ids = {};
    for (const [email, name, role, org] of people) {
      await client.query(
        'INSERT INTO users(email,"fullName",password,role,"isActive","organizationId") VALUES($1,$2,$3,$4,true,$5) ON CONFLICT(email) DO NOTHING',
        [email, name, hash, role, org],
      );
      const [u] = (
        await client.query('SELECT id FROM users WHERE email=$1', [email])
      ).rows;
      ids[email] = u.id;
      await client.query(
        "INSERT INTO community_profiles(user_id,display_name,bio,region,crops) VALUES($1,$2,'Tài khoản mẫu trong môi trường local.','Miền Tây','Thanh long, sầu riêng') ON CONFLICT DO NOTHING",
        [u.id, name],
      );
      if (org)
        await client.query(
          'INSERT INTO agrilink_memberships(user_id,organization_id,can_publish) VALUES($1,$2,true) ON CONFLICT DO NOTHING',
          [u.id, org],
        );
    }
    await client.query(
      "INSERT INTO agrilink_platform_roles(user_id,role) VALUES($1,'admin') ON CONFLICT DO NOTHING",
      [ids['moderator@agrilink.vn']],
    );
    const demoPosts = [
      [
        ids['farmer-demo@agrilink.vn'],
        null,
        'question',
        'Mọi người thường ghi chép lịch tưới và bón phân như thế nào?\n\nMình đang muốn bắt đầu ghi nhật ký cho vườn thanh long để dễ theo dõi giữa các đợt chăm sóc. Bà con có cách nào đơn giản, dễ duy trì không? Cùng chia sẻ kinh nghiệm nhé!\n\n[Bài mẫu để trải nghiệm cộng đồng]',
        'cultivation',
        'Thanh long',
        '10000000-0000-4000-8000-000000000001',
      ],
      [
        ids['dealer-demo@agrilink.vn'],
        orgId,
        'announcement',
        'Chào bà con, An Phú đã có mặt trên cộng đồng AgriLink!\n\nĐây là nơi chúng ta trao đổi nhu cầu vật tư, lịch thu hoạch và cùng giải đáp những câu hỏi trong công việc hằng ngày. Bà con đang quan tâm chủ đề nào nhất?\n\n[Thông báo mẫu, không phải đề nghị giao dịch thật]',
        'supplies',
        '',
        '10000000-0000-4000-8000-000000000002',
      ],
      [
        ids['farmer-demo@agrilink.vn'],
        null,
        'experience',
        'Một cuốn sổ nhỏ, một mùa vụ dễ theo dõi hơn.\n\nMỗi cuối ngày mình dành vài phút ghi lại việc đã làm trong vườn, thời tiết và những điều cần kiểm tra hôm sau. Khi trao đổi với đại lý, có thông tin cụ thể giúp hai bên hiểu nhau nhanh hơn.\n\n[Bài chia sẻ mẫu]',
        'harvest',
        'Sầu riêng',
        '10000000-0000-4000-8000-000000000003',
      ],
    ];
    for (const [author, org, kind, body, topic, crop, key] of demoPosts) {
      const rows = await client.query(
        "INSERT INTO community_posts(author_id,organization_id,kind,body,topics,crop,region,state,request_id) VALUES($1,$2,$3,$4,$5,$6,'Miền Tây','published',$7) ON CONFLICT DO NOTHING RETURNING id",
        [author, org, kind, body, [topic], crop, key],
      );
      if (rows.rows[0])
        await client.query(
          "INSERT INTO community_actions(user_id,post_id,kind) VALUES($1,$2,'subscription') ON CONFLICT DO NOTHING",
          [author, rows.rows[0].id],
        );
    }
    console.log(
      'Local demo accounts ready:',
      people.map((p) => p[0]).join(', '),
    );
    console.log(
      'Their passwords use the local SEED_FARMER_PASSWORD; existing passwords were not changed.',
    );
  } else
    throw new Error(
      'Usage: node scripts/community-local.cjs inspect|backup|clone|demo',
    );
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => client.end().catch(() => {}));
