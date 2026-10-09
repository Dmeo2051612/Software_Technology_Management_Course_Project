require('dotenv').config();
const { randomUUID } = require('crypto');

const baseUrl =
  process.env.COMMUNITY_SMOKE_URL || 'http://127.0.0.1:3001/api/v1';
const demoPassword = process.env.SEED_FARMER_PASSWORD;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(
  path,
  { token, method = 'GET', body, form, expected = [200, 201] } = {},
) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.arrayBuffer();
  if (!expected.includes(response.status)) {
    const details =
      payload &&
      typeof payload === 'object' &&
      !(payload instanceof ArrayBuffer)
        ? JSON.stringify(payload)
        : '';
    throw new Error(
      `${method} ${path} returned ${response.status}: ${details}`,
    );
  }
  return payload && payload.success === true ? payload.data : payload;
}

async function login(identifier, password) {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { email: identifier, password },
  });
  assert(result.accessToken, `Login failed for ${identifier}`);
  return result.accessToken;
}

async function main() {
  assert(
    process.env.NODE_ENV !== 'production',
    'Smoke test refuses to run in production.',
  );
  assert(demoPassword && adminPassword, 'Missing local seed passwords.');
  assert(
    /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(`${baseUrl}/`),
    'Smoke test only accepts a local API URL.',
  );

  const farmer = await login('farmer-demo@agrilink.vn', demoPassword);
  const dealer = await login('dealer-demo@agrilink.vn', demoPassword);
  const moderator = await login('moderator@agrilink.vn', demoPassword);
  const legacyDealer = await login('dtd2x', adminPassword);

  const farmerOverview = await request('/community/me', { token: farmer });
  const dealerOverview = await request('/community/me', { token: dealer });
  assert(
    farmerOverview.viewer.role === 'farmer',
    'Farmer community overview is invalid.',
  );
  assert(
    dealerOverview.viewer.memberships.length > 0,
    'Dealer membership is missing.',
  );

  const requestId = randomUUID();
  const postBody = {
    body: 'Bài kiểm tra tự động cho luồng cộng đồng AgriLink. Nội dung này chỉ nằm trong database thử nghiệm.',
    kind: 'question',
    state: 'published',
    crop: 'Lúa',
    region: 'Đồng bằng sông Cửu Long',
    source: '',
    observedAt: '',
    topics: ['cultivation'],
    mediaIds: [],
    requestId,
  };
  const created = await request('/community/posts', {
    token: farmer,
    method: 'POST',
    body: postBody,
  });
  const repeated = await request('/community/posts', {
    token: farmer,
    method: 'POST',
    body: postBody,
  });
  assert(created.id === repeated.id, 'Post idempotency failed.');

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
  const media = await request('/community/media', {
    token: farmer,
    method: 'POST',
    form,
  });
  assert(media.id, 'Media upload failed.');
  const mediaBytes = await request(`/community/media/${media.id}`, {
    token: farmer,
  });
  assert(mediaBytes.byteLength > 0, 'Uploaded media cannot be read.');

  const comment = await request(`/community/posts/${created.id}/comments`, {
    token: dealer,
    method: 'POST',
    body: {
      body: 'Đại lý đã phản hồi trong bài kiểm tra tự động.',
      requestId: randomUUID(),
    },
  });
  await request(`/community/posts/${created.id}/actions/like`, {
    token: dealer,
    method: 'PUT',
  });
  await request(`/community/posts/${created.id}/helpful/${comment.id}`, {
    token: farmer,
    method: 'PUT',
  });
  const comments = await request(`/community/posts/${created.id}/comments`, {
    token: farmer,
  });
  const updatedPost = await request(`/community/posts/${created.id}`, {
    token: farmer,
  });
  assert(
    comments.items.some((item) => item.id === comment.id) &&
      updatedPost.helpfulCommentId === comment.id,
    'Helpful comment flow failed.',
  );

  const notifications = await request('/notifications', { token: farmer });
  assert(notifications.unread > 0, 'Community notifications were not created.');

  const report = await request('/community/reports', {
    token: farmer,
    method: 'POST',
    body: {
      targetType: 'comment',
      targetId: comment.id,
      reason: 'Báo cáo kiểm tra tự động để xác minh hàng đợi kiểm duyệt.',
    },
  });
  const reports = await request('/platform/community/reports?state=open', {
    token: moderator,
  });
  assert(
    reports.some((item) => item.id === report.id),
    'Moderator cannot see the report.',
  );
  await request(`/platform/community/reports/${report.id}/actions`, {
    token: moderator,
    method: 'POST',
    body: {
      action: 'dismiss',
      reason: 'Đóng báo cáo do đây là dữ liệu kiểm tra tự động.',
    },
  });
  await request(`/platform/community/reports/${report.id}/actions`, {
    token: moderator,
    method: 'POST',
    body: {
      action: 'dismiss',
      reason: 'Không được xử lý cùng một báo cáo hai lần.',
    },
    expected: [400],
  });

  const organizations = await request('/platform/organizations', {
    token: moderator,
  });
  assert(
    organizations.length >= 2,
    'Platform organization management is unavailable.',
  );

  await request('/products', { token: farmer, expected: [403] });
  const legacyProducts = await request('/products', { token: legacyDealer });
  const isolatedProducts = await request('/products', { token: dealer });
  const legacyItems = Array.isArray(legacyProducts)
    ? legacyProducts
    : legacyProducts.items || legacyProducts.data || [];
  const isolatedItems = Array.isArray(isolatedProducts)
    ? isolatedProducts
    : isolatedProducts.items || isolatedProducts.data || [];
  assert(legacyItems.length > 0, 'Legacy dealer test data is missing.');
  assert(
    isolatedItems.length === 0,
    'New organization can see legacy organization products.',
  );
  await request(`/products/${legacyItems[0].id}`, {
    token: dealer,
    expected: [404],
  });

  console.log(
    JSON.stringify(
      {
        passed: true,
        checks: [
          'role access',
          'community overview',
          'idempotent posts',
          'media validation',
          'comments and helpful answers',
          'likes and notifications',
          'report moderation',
          'organization administration',
          'farmer business-route denial',
          'tenant row isolation',
        ],
        postId: created.id,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
