import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  assertCanPost,
  complaintCategories,
  complaintEligibility,
  nextComplaintStatus,
  orderLineText,
  threadSide,
} from './messaging-rules';

const buyer = { id: 'u-farmer', role: 'farmer', platformRole: null, memberships: [] as { id: string }[] };
const staff = { id: 'u-staff', role: 'manager', platformRole: null, memberships: [{ id: 'org-1' }] };
const otherStaff = { id: 'u-other', role: 'owner', platformRole: null, memberships: [{ id: 'org-2' }] };
const admin = { id: 'u-admin', role: 'farmer', platformRole: 'admin', memberships: [] as { id: string }[] };

const chat = { kind: 'chat', buyerId: 'u-farmer', organizationId: 'org-1', status: 'open', escalatedAt: null, blockedByBuyer: false };

describe('threadSide', () => {
  it('recognises the buyer and the dealer staff', () => {
    expect(threadSide(buyer, chat)).toBe('buyer');
    expect(threadSide(staff, chat)).toBe('dealer');
  });

  it('hides a thread from other dealers and from admins unless it concerns them', () => {
    expect(threadSide(otherStaff, chat)).toBeNull();
    expect(threadSide(admin, chat)).toBeNull();
    expect(threadSide(admin, { ...chat, kind: 'complaint', escalatedAt: new Date() })).toBe('admin');
    expect(threadSide(admin, { ...chat, kind: 'support', organizationId: null })).toBe('admin');
    expect(threadSide(admin, { ...chat, kind: 'complaint' })).toBeNull();
  });

  it('does not give warehouse or accounting staff the dealer inbox', () => {
    expect(threadSide({ ...staff, role: 'warehouse' }, chat)).toBeNull();
    expect(threadSide({ ...staff, role: 'cashier' }, chat)).toBe('dealer');
  });

  it('treats a staff member who placed the order as the buyer', () => {
    expect(threadSide({ ...staff, id: 'u-farmer' }, chat)).toBe('buyer');
  });
});

describe('assertCanPost', () => {
  it('blocks dealer messages in a chat the farmer blocked', () => {
    expect(() => assertCanPost({ ...chat, blockedByBuyer: true }, 'dealer')).toThrow(ConflictException);
    expect(() => assertCanPost({ ...chat, blockedByBuyer: true }, 'buyer')).not.toThrow();
  });

  it('closes resolved complaints and closed support requests', () => {
    expect(() => assertCanPost({ ...chat, kind: 'complaint', status: 'resolved' }, 'buyer')).toThrow('Khiếu nại đã đóng.');
    expect(() => assertCanPost({ ...chat, kind: 'support', status: 'closed' }, 'buyer')).toThrow('Yêu cầu hỗ trợ đã đóng.');
  });
});

describe('complaints', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  it('offers categories that fit the order kind', () => {
    expect(complaintCategories('sell')).toEqual(['wrong_weight', 'late_payment', 'no_show', 'other']);
    expect(complaintCategories('buy')).toEqual(['wrong_item', 'damaged', 'late_delivery', 'other']);
  });

  it('allows complaints on handled orders within 14 days', () => {
    expect(complaintEligibility({ status: 'completed', updatedAt: new Date('2026-09-20T00:00:00Z') }, now)).toBeNull();
    expect(complaintEligibility({ status: 'pending', updatedAt: now }, now)).toBe('Chỉ khiếu nại được đơn đã được đại lý xử lý.');
    expect(complaintEligibility({ status: 'rejected', updatedAt: now }, now)).toBe('Chỉ khiếu nại được đơn đã được đại lý xử lý.');
    expect(complaintEligibility({ status: 'completed', updatedAt: new Date('2026-09-10T00:00:00Z') }, now)).toBe('Đã quá 14 ngày kể từ lần cập nhật cuối của đơn.');
  });

  it('moves through dealer proposal, farmer decision, escalation and admin resolution', () => {
    expect(nextComplaintStatus('open', 'propose', 'dealer')).toBe('dealer_replied');
    expect(nextComplaintStatus('dealer_replied', 'propose', 'dealer')).toBe('dealer_replied');
    expect(nextComplaintStatus('dealer_replied', 'accept', 'buyer')).toBe('resolved');
    expect(nextComplaintStatus('dealer_replied', 'escalate', 'buyer')).toBe('escalated');
    expect(nextComplaintStatus('open', 'escalate', 'system')).toBe('escalated');
    expect(nextComplaintStatus('escalated', 'resolve', 'admin')).toBe('resolved');
  });

  it('rejects transitions out of turn', () => {
    expect(() => nextComplaintStatus('open', 'accept', 'buyer')).toThrow(ConflictException);
    expect(() => nextComplaintStatus('open', 'escalate', 'buyer')).toThrow('Hãy chờ đại lý phản hồi hoặc tự động chuyển sau 3 ngày.');
    expect(() => nextComplaintStatus('escalated', 'propose', 'dealer')).toThrow(ConflictException);
    expect(() => nextComplaintStatus('open', 'resolve', 'admin')).toThrow(ConflictException);
    expect(() => nextComplaintStatus('open', 'propose', 'buyer')).toThrow(BadRequestException);
  });
});

describe('orderLineText', () => {
  it('describes status changes for the chat timeline', () => {
    expect(orderLineText('confirmed', 'AL-1')).toBe('Đại lý đã xác nhận đơn AL-1');
    expect(orderLineText('cancelled', 'AL-1')).toBe('Đơn AL-1 đã bị huỷ');
    expect(orderLineText('pending', 'AL-1')).toBeNull();
  });
});
