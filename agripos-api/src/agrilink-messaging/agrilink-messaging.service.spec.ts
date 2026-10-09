import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgrilinkMessagingService } from './agrilink-messaging.service';

jest.mock('sharp', () => jest.fn());
jest.mock('node:fs/promises', () => ({ mkdir: jest.fn().mockResolvedValue(undefined) }));

const farmer = { id: 'u-farmer', role: 'farmer', platformRole: null, memberships: [], organizationId: null, suspended: false } as any;
const staff = { id: 'u-staff', role: 'manager', platformRole: null, memberships: [{ id: 'org-1' }], organizationId: 'org-1', suspended: false } as any;
const admin = { id: 'u-admin', role: 'farmer', platformRole: 'admin', memberships: [], organizationId: null, suspended: false } as any;
const outsider = { id: 'u-x', role: 'farmer', platformRole: null, memberships: [], organizationId: null, suspended: false } as any;

const thread = (over: Record<string, unknown> = {}) => ({
  id: 't-1', kind: 'chat', code: '', buyerId: 'u-farmer', organizationId: 'org-1', orderId: null, status: 'open',
  category: null, subject: '', buyerWish: null, dealerProposal: null, blockedByBuyer: false, escalatedAt: null,
  resolvedAt: null, resolution: null, resolutionNote: '', createdAt: '2026-09-29T00:00:00Z', lastMessageAt: '2026-09-29T00:00:00Z',
  ...over,
});

function fakeDb(rows: Record<string, any[]>) {
  const calls: Array<[string, unknown[]]> = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push([sql, params]);
    const key = Object.keys(rows).find((k) => sql.includes(k));
    return Promise.resolve(key ? rows[key] : []);
  });
  return { db: { query, transaction: (cb: any) => cb({ query }) } as any, calls };
}
const LOAD = 'FROM agrilink_threads t WHERE t.id=$1';
const has = (calls: Array<[string, unknown[]]>, text: string) => calls.filter(([s]) => s.includes(text));

describe('AgrilinkMessagingService — access', () => {
  it('hides a thread from people who are not part of it', async () => {
    const { db } = fakeDb({ [LOAD]: [thread()] });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.messages(outsider, 't-1', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.post(outsider, 't-1', { body: 'xin chào' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets the dealer inbox only show its own organization', async () => {
    const { db, calls } = fakeDb({});
    await new AgrilinkMessagingService(db).threads(staff, { as: 'dealer' });
    const [sql, params] = calls[0];
    expect(sql).toContain('t.organization_id=$2');
    expect(sql).toContain("t.kind<>'support'");
    expect(params).toEqual(['u-staff', 'org-1']);
    await expect(new AgrilinkMessagingService(db).threads(farmer, { as: 'dealer' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds the buyer inbox without unused parameters (Postgres rejects untyped ones)', async () => {
    const { db, calls } = fakeDb({});
    await new AgrilinkMessagingService(db).threads(farmer, { as: 'buyer', kind: 'chat' });
    const [sql, params] = calls[0];
    expect(sql).toContain('t.buyer_id=$1');
    expect(sql).toContain('t.kind=$2');
    expect(params).toEqual(['u-farmer', 'chat']);
  });
});

describe('AgrilinkMessagingService — chat', () => {
  it('lets a farmer open a chat but not a dealer with itself', async () => {
    const { db, calls } = fakeDb({
      'FROM agrilink_organizations WHERE id=$1 AND marketplace_enabled': [{ id: 'org-1' }],
      "VALUES('chat',$1,$2)": [{ id: 't-1' }],
      [LOAD]: [thread()],
    });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.openChat(staff, 'org-1')).rejects.toBeInstanceOf(BadRequestException);
    const opened = await svc.openChat(farmer, 'org-1');
    expect(opened.side).toBe('buyer');
    expect(has(calls, "ON CONFLICT (buyer_id,organization_id) WHERE kind='chat'")).toHaveLength(1);
  });

  it('validates message content and image ownership', async () => {
    const { db } = fakeDb({ [LOAD]: [thread()] });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.post(farmer, 't-1', { body: '   ' })).rejects.toThrow('Tin nhắn trống.');
    await expect(svc.post(farmer, 't-1', { images: ['/uploads/messages/t-2-1.webp'] })).rejects.toThrow('Ảnh không hợp lệ.');
  });

  it('stores a message, bumps the thread and marks it read for the sender', async () => {
    const { db, calls } = fakeDb({ [LOAD]: [thread()], 'INSERT INTO agrilink_messages': [{ id: 'm-1' }] });
    await new AgrilinkMessagingService(db).post(staff, 't-1', { body: ' Dạ còn hàng ạ ', images: ['/uploads/messages/t-1-5.webp'] });
    const [, params] = has(calls, 'INSERT INTO agrilink_messages')[0];
    expect(params).toEqual(['t-1', 'u-staff', 'dealer', 'Dạ còn hàng ạ', JSON.stringify(['/uploads/messages/t-1-5.webp'])]);
    expect(has(calls, 'SET last_message_at=now()')).toHaveLength(1);
    expect(has(calls, 'INSERT INTO agrilink_thread_reads')[0][1]).toEqual(['t-1', 'u-staff']);
  });

  it('refuses dealer replies after the farmer blocked the dealer', async () => {
    const { db } = fakeDb({ [LOAD]: [thread({ blockedByBuyer: true })] });
    await expect(new AgrilinkMessagingService(db).post(staff, 't-1', { body: 'alo' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('only lets the farmer block a chat', async () => {
    const { db } = fakeDb({ [LOAD]: [thread()] });
    await expect(new AgrilinkMessagingService(db).setBlocked(staff, 't-1', true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(new AgrilinkMessagingService(db).setBlocked(farmer, 't-1', true)).resolves.toEqual({ blocked: true });
  });

  it('lets the buyer open the order chat but only lets the dealer into an existing, unblocked one', async () => {
    const order = { 'FROM agrilink_orders WHERE id=$1': [{ requesterId: 'u-farmer', organizationId: 'org-1' }] };
    const withThread = fakeDb({ ...order, "VALUES('chat',$1,$2)": [{ id: 't-1' }], 'NOT blocked_by_buyer': [{ id: 't-1' }] });
    const svc = new AgrilinkMessagingService(withThread.db);
    await expect(svc.chatForOrder(farmer, 'o-1')).resolves.toEqual({ id: 't-1' });
    await expect(svc.chatForOrder(staff, 'o-1')).resolves.toEqual({ id: 't-1' });
    expect(has(withThread.calls, "VALUES('chat',$1,$2)")).toHaveLength(1); // chỉ phía người mua tạo
    await expect(svc.chatForOrder(outsider, 'o-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.chatForOrder({ ...staff, role: 'warehouse' }, 'o-1')).rejects.toBeInstanceOf(NotFoundException);
    const none = new AgrilinkMessagingService(fakeDb(order).db);
    await expect(none.chatForOrder(staff, 'o-1')).rejects.toThrow('Khách chưa có cuộc trò chuyện với đại lý.');
  });

  it('shows the replying staff name to the dealer only', async () => {
    const rows = [{ id: 'm-1', senderSide: 'dealer', body: 'Dạ', staffName: 'Hằng', createdAt: '2026-09-29T00:00:00.000Z' }];
    const svc = (x: any) => new AgrilinkMessagingService(fakeDb({ [LOAD]: [thread()], 'FROM agrilink_messages m': x }).db);
    expect((await svc(rows).messages(staff, 't-1', {}))[0]).toHaveProperty('staffName', 'Hằng');
    expect((await svc(rows).messages(farmer, 't-1', {}))[0]).not.toHaveProperty('staffName');
  });

  it('limits each sender to 20 messages a minute', async () => {
    const { db } = fakeDb({ [LOAD]: [thread()], 'AS recent': [{ recent: 20 }] });
    await expect(new AgrilinkMessagingService(db).post(farmer, 't-1', { body: 'alo' })).rejects.toThrow('Bạn gửi quá nhanh');
  });

  it('rejects an invalid polling cursor', async () => {
    const { db } = fakeDb({ [LOAD]: [thread()] });
    await expect(new AgrilinkMessagingService(db).messages(farmer, 't-1', { after: 'hôm qua' })).rejects.toThrow('Thời điểm không hợp lệ.');
  });
});

describe('AgrilinkMessagingService — complaints', () => {
  const order = { id: 'o-1', code: 'AL-1', kind: 'buy', status: 'completed', organizationId: 'org-1', requesterId: 'u-farmer', updatedAt: new Date() };
  const base = {
    'FROM agrilink_orders WHERE id=$1 FOR UPDATE': [order],
    "nextval('agrilink_complaint_seq')": [{ n: 7 }],
    "VALUES('complaint'": [{ id: 't-9' }],
    [LOAD]: [thread({ id: 't-9', kind: 'complaint', orderId: 'o-1' })],
  };
  const dto = { category: 'damaged', body: '1 bao bị rách, phân vón cục, không dùng được.', wish: 'exchange' as const };

  it('creates a complaint for the order owner and alerts the dealer', async () => {
    const { db, calls } = fakeDb(base);
    const created = await new AgrilinkMessagingService(db).createComplaint(farmer, 'o-1', dto);
    expect(created.side).toBe('buyer');
    const [, params] = has(calls, "VALUES('complaint'")[0];
    expect(params).toEqual(['u-farmer', 'org-1', 'o-1', 'KN-0007', 'damaged', 'Hàng hỏng · Đơn AL-1', 'exchange']);
    expect(has(calls, "'agrilink_complaint'")[0][1]).toEqual(['org-1', 'u-farmer', 'agrilink-complaint:t-9:open:dealer']);
  });

  it('refuses other people’s orders, pending orders, wrong categories and duplicates', async () => {
    const svc = (rows: Record<string, any[]>) => new AgrilinkMessagingService(fakeDb({ ...base, ...rows }).db);
    await expect(svc({}).createComplaint(outsider, 'o-1', dto)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc({ 'FROM agrilink_orders WHERE id=$1 FOR UPDATE': [{ ...order, status: 'pending' }] }).createComplaint(farmer, 'o-1', dto))
      .rejects.toThrow('Chỉ khiếu nại được đơn đã được đại lý xử lý.');
    await expect(svc({}).createComplaint(farmer, 'o-1', { ...dto, category: 'wrong_weight' })).rejects.toThrow('Loại vấn đề không phù hợp với đơn.');
    await expect(svc({ "kind='complaint' AND status<>'resolved'": [{ id: 't-old' }] }).createComplaint(farmer, 'o-1', dto))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('runs dealer proposal → farmer acceptance', async () => {
    const complaint = thread({ id: 't-9', kind: 'complaint', status: 'open' });
    const { db, calls } = fakeDb({ [LOAD]: [complaint] });
    const svc = new AgrilinkMessagingService(db);
    await svc.propose(staff, 't-9', { proposal: 'exchange', note: 'Chiều nay đổi bao mới.' });
    expect(has(calls, 'SET status=$2')[0][1]).toEqual(['t-9', 'dealer_replied']);
    await expect(svc.accept(farmer, 't-9')).rejects.toBeInstanceOf(ConflictException); // vẫn 'open' trong dữ liệu giả
    const replied = fakeDb({ [LOAD]: [{ ...complaint, status: 'dealer_replied' }] });
    await new AgrilinkMessagingService(replied.db).accept(farmer, 't-9');
    expect(has(replied.calls, 'SET status=$2')[0][1]).toEqual(['t-9', 'resolved']);
    expect(has(replied.calls, "resolution='agreed'")).toHaveLength(1);
  });

  it('only lets platform admins resolve', async () => {
    const { db } = fakeDb({ [LOAD]: [thread({ kind: 'complaint', status: 'escalated', escalatedAt: new Date() })] });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.resolve(farmer, 't-1', { resolution: 'settled', note: 'Đã thoả thuận' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.resolve(admin, 't-1', { resolution: 'settled', note: 'Đã thoả thuận' })).resolves.toMatchObject({ side: 'admin' });
  });

  it('auto-escalates complaints the dealer ignored for 72 hours, one transaction each', async () => {
    const { db, calls } = fakeDb({
      "status='open' AND created_at <=": [{ id: 't-9' }, { id: 't-10' }],
      "SET status='escalated'": [{ id: 't-9', buyerId: 'u-farmer', organizationId: 'org-1' }],
    });
    const transaction = jest.spyOn(db, 'transaction');
    await expect(new AgrilinkMessagingService(db).autoEscalate()).resolves.toBe(2);
    expect(has(calls, "status='open' AND created_at <=")[0][1]).toEqual([72]);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(has(calls, "SET status='escalated'")[0][0]).toContain("WHERE id=$1 AND status='open'");
  });

  it('skips a complaint the dealer answered just before the cron', async () => {
    const { db, calls } = fakeDb({ "status='open' AND created_at <=": [{ id: 't-9' }] });
    await expect(new AgrilinkMessagingService(db).autoEscalate()).resolves.toBe(0);
    expect(has(calls, 'INSERT INTO agrilink_messages')).toHaveLength(0);
  });

  it('lets moderators see the queue but only admins decide', async () => {
    const moderator = { ...admin, platformRole: 'moderator' };
    const { db } = fakeDb({ [LOAD]: [thread({ kind: 'complaint', status: 'escalated', escalatedAt: new Date() })] });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.adminThreads(moderator, { kind: 'complaint' })).resolves.toEqual([]);
    await expect(svc.resolve(moderator, 't-1', { resolution: 'settled', note: 'Đã thoả thuận' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AgrilinkMessagingService — support', () => {
  it('marks a support request answered when an admin replies and notifies the user', async () => {
    const { db, calls } = fakeDb({
      [LOAD]: [thread({ kind: 'support', organizationId: null, status: 'open' })],
      'INSERT INTO agrilink_messages': [{ id: 'm-2' }],
    });
    await new AgrilinkMessagingService(db).post(admin, 't-1', { body: 'Anh vào Hồ sơ để đổi số điện thoại.' });
    expect(has(calls, "SET status='answered'")).toHaveLength(1);
    expect(has(calls, 'INSERT INTO community_notifications')[0][1]).toEqual(['u-farmer', 'u-admin', 'agrilink_support', 'agrilink-support:t-1:m-2']);
  });

  it('lets the requester close the request but not a dealer', async () => {
    const { db } = fakeDb({ [LOAD]: [thread({ kind: 'support', organizationId: null })] });
    const svc = new AgrilinkMessagingService(db);
    await expect(svc.closeSupport(farmer, 't-1')).resolves.toEqual({ closed: true });
    await expect(svc.closeSupport(outsider, 't-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
