import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './api';
import { messagingApi } from './agrilink-messaging.service';

vi.mock('./api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { data: 'ok' } });
  vi.mocked(api.post).mockResolvedValue({ data: { data: 'ok' } });
});

describe('messaging API contract', () => {
  it('reads threads, messages and unread counts with exact params', async () => {
    await messagingApi.threads({ as: 'dealer', kind: 'chat' });
    await messagingApi.unread('dealer');
    await messagingApi.thread('t');
    await messagingApi.messages('t', { after: '2026-09-29T02:00:00.000Z' });
    await messagingApi.messages('t');
    await messagingApi.chatForOrder('o');
    await messagingApi.adminThreads('complaint', 'escalated');
    expect(vi.mocked(api.get).mock.calls).toEqual([
      ['/marketplace/threads', { params: { as: 'dealer', kind: 'chat' } }],
      ['/marketplace/threads/unread-count', { params: { as: 'dealer' } }],
      ['/marketplace/threads/t'],
      ['/marketplace/threads/t/messages', { params: { after: '2026-09-29T02:00:00.000Z' } }],
      ['/marketplace/threads/t/messages', { params: {} }],
      ['/marketplace/orders/o/chat'],
      ['/platform/agrilink/threads', { params: { kind: 'complaint', status: 'escalated' } }],
    ]);
  });

  it('writes with exact paths and bodies (only declared fields)', async () => {
    await messagingApi.send('t', { body: 'Xin chào', images: [] });
    await messagingApi.read('t');
    await messagingApi.openChat('d');
    await messagingApi.block('t', true);
    await messagingApi.block('t', false);
    await messagingApi.complain('o', { category: 'damaged', body: 'Một bao bị rách, phân vón cục.', wish: 'exchange' });
    await messagingApi.propose('t', { proposal: 'exchange', note: 'Đổi bao mới' });
    await messagingApi.accept('t');
    await messagingApi.escalate('t');
    await messagingApi.support({ category: 'account', subject: 'Đổi số', body: 'Em muốn đổi số điện thoại.' });
    await messagingApi.close('t');
    await messagingApi.resolve('t', { resolution: 'settled', note: 'Đã thoả thuận' });
    expect(vi.mocked(api.post).mock.calls).toEqual([
      ['/marketplace/threads/t/messages', { body: 'Xin chào', images: [] }],
      ['/marketplace/threads/t/read'],
      ['/marketplace/chats', { dealerId: 'd' }],
      ['/marketplace/chats/t/block'],
      ['/marketplace/chats/t/unblock'],
      ['/marketplace/my-orders/o/complaints', { category: 'damaged', body: 'Một bao bị rách, phân vón cục.', wish: 'exchange' }],
      ['/marketplace/threads/t/propose', { proposal: 'exchange', note: 'Đổi bao mới' }],
      ['/marketplace/threads/t/accept'],
      ['/marketplace/threads/t/escalate'],
      ['/marketplace/support', { category: 'account', subject: 'Đổi số', body: 'Em muốn đổi số điện thoại.' }],
      ['/marketplace/threads/t/close'],
      ['/platform/agrilink/threads/t/resolve', { resolution: 'settled', note: 'Đã thoả thuận' }],
    ]);
  });

  it('uploads message images as multipart', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await messagingApi.uploadImage('t', file);
    const [url, form, config] = vi.mocked(api.post).mock.lastCall!;
    expect(url).toBe('/marketplace/threads/t/images');
    expect((form as FormData).get('file')).toBe(file);
    expect(config).toEqual({ headers: { 'Content-Type': 'multipart/form-data' } });
  });
});
