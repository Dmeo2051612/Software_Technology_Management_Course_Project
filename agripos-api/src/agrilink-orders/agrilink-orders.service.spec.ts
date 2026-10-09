import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgrilinkOrdersService } from './agrilink-orders.service';

const owner = { userId: 'u-1', role: 'owner', organizationId: 'org-1' };

function setup(order: any, extra: Partial<Record<string, jest.Mock>> = {}) {
  const manager: any = {
    findOne: jest.fn((entity: any) =>
      Promise.resolve(
        entity.name === 'AgrilinkOrder'
          ? order
          : entity.name === 'User'
            ? { fullName: 'Chủ A' }
            : null,
      ),
    ),
    find: jest.fn().mockResolvedValue(order?.items ?? []),
    save: jest.fn((_e: any, v: any) => Promise.resolve(v)),
    create: jest.fn((_e: any, v: any) => v),
    query: jest.fn().mockResolvedValue([]),
    ...extra,
  };
  const dataSource: any = {
    transaction: jest.fn((cb: any) => cb(manager)),
    query: jest.fn().mockResolvedValue([]),
  };
  const svc = new AgrilinkOrdersService(dataSource);
  jest.spyOn(svc, 'detail').mockResolvedValue({ id: order?.id } as any);
  return { svc, manager };
}

describe('AgrilinkOrdersService.transition', () => {
  it('cancels the linked booking on dealer rejection through the transaction manager', async () => {
    const order = { id: 'al-booked', status: 'pending', fulfillment: 'delivery', requesterId: 'farmer', organizationId: 'org-1', intentId: 'intent-1' };
    const { svc, manager } = setup(order);
    await svc.transition('al-booked', 'reject', owner, 'Không nhận được');
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE agrilink_service_bookings SET status='cancelled'"), ['al-booked']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE agrilink_intents SET status=CASE WHEN window_end"), ['intent-1']);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE agrilink_intent_offers SET status='expired'"), ['intent-1', 'org-1']);
  });
  it('confirms a pending order, stamps confirmedAt and records an event', async () => {
    const order = {
      id: 'al-1',
      status: 'pending',
      fulfillment: 'pickup',
      requesterId: 'farmer-1',
      organizationId: 'org-1',
    };
    const { svc, manager } = setup(order);
    await svc.transition('al-1', 'confirm', owner);
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'confirmed',
        confirmedAt: expect.any(Date),
      }),
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fromStatus: 'pending',
        toStatus: 'confirmed',
        actorName: 'Chủ A',
      }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('community_notifications'),
      expect.arrayContaining(['farmer-1']),
    );
  });

  it('stores reject reason and cancelledBy for dealer cancel', async () => {
    const order = {
      id: 'al-2',
      status: 'confirmed',
      fulfillment: 'pickup',
      requesterId: 'f',
      organizationId: 'org-1',
    };
    const { svc, manager } = setup(order);
    await svc.transition('al-2', 'cancel', owner, 'Hết hàng');
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'cancelled',
        cancelReason: 'Hết hàng',
        cancelledBy: 'dealer',
      }),
    );
  });

  it('throws 409 on invalid transition and 404 when missing', async () => {
    await expect(
      setup({
        id: 'x',
        status: 'completed',
        fulfillment: 'pickup',
      }).svc.transition('x', 'confirm', owner),
    ).rejects.toThrow(ConflictException);
    await expect(
      setup(null).svc.transition('y', 'confirm', owner),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('AgrilinkOrdersService vouchers', () => {
  const voucherOrder = (status: string) => ({
    id: 'al-v', status, fulfillment: 'pickup', requesterId: 'farmer-1', organizationId: 'org-1',
    voucherId: 'v-1', voucherSnapshot: { title: 'Giảm 5%', type: 'percent', value: 5, maxDiscount: 50000 }, discountAmount: 50000,
    items: [{ id: 'i-1', quantity: 10, unitPrice: 134000 }],
  });
  it.each([['reject', 'pending'], ['cancel', 'confirmed']] as const)('%s gives the voucher use back', async (action, status) => {
    const order = voucherOrder(status);
    const query = jest.fn((sql: string) => Promise.resolve(sql.includes('SET order_id=NULL') ? [{ voucher_id: 'v-1' }] : []));
    const { svc } = setup(order, { query });
    await svc.transition('al-v', action, owner, 'Hết hàng');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('SET order_id=NULL'), ['v-1', 'al-v']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('used_count=GREATEST(used_count-1,0)'), ['v-1']);
  });
  it('keeps the voucher when the order is confirmed', async () => {
    const { svc, manager } = setup(voucherOrder('pending'));
    await svc.transition('al-v', 'confirm', owner);
    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining('agrilink_voucher'), expect.anything());
  });
  it('recomputes the discount when the dealer edits lines, without re-checking the minimum', async () => {
    const order = voucherOrder('pending');
    const { svc } = setup(order);
    await svc.updateItems('al-v', { items: [{ itemId: 'i-1', quantity: 2, unitPrice: 134000 }] }, owner);
    expect(order).toMatchObject({ estimatedTotal: 268000, discountAmount: 13400 });
  });
});

describe('AgrilinkOrdersService.updateItems', () => {
  it('updates quantities/prices and recomputes the estimate', async () => {
    const items = [
      { id: 'i-1', quantity: 2, unitPrice: 100 },
      { id: 'i-2', quantity: 1, unitPrice: 50 },
    ];
    const order = {
      id: 'al-3',
      status: 'pending',
      fulfillment: 'pickup',
      requesterId: 'f',
      organizationId: 'org-1',
      items,
    };
    const { svc, manager } = setup(order);
    await svc.updateItems(
      'al-3',
      { items: [{ itemId: 'i-1', quantity: 3, unitPrice: 100 }] },
      owner,
    );
    expect(manager.save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ estimatedTotal: 350 }),
    );
  });

  it('truncates a long change note to fit agrilink_order_events.note (varchar 500)', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `i-${i}`,
      itemName: 'Phân bón NPK cao cấp đóng bao loại đặc biệt số '.repeat(3) + i,
      quantity: 2,
      unitPrice: 100,
    }));
    const order = {
      id: 'al-5',
      status: 'pending',
      fulfillment: 'pickup',
      requesterId: 'f',
      organizationId: 'org-1',
      items,
    };
    const { svc, manager } = setup(order);
    await svc.updateItems(
      'al-5',
      {
        items: items.map((it) => ({
          itemId: it.id,
          quantity: 3,
          unitPrice: 100,
        })),
      },
      owner,
    );
    const eventCall = manager.save.mock.calls.find(
      ([, v]: any[]) => v && typeof v === 'object' && 'note' in v,
    );
    expect(eventCall).toBeDefined();
    expect(eventCall![1].note.length).toBeLessThanOrEqual(500);
  });

  it('gives two consecutive edits distinct notification event keys', async () => {
    const items = [
      { id: 'i-1', itemName: 'Phân NPK', quantity: 2, unitPrice: 100 },
    ];
    const order = {
      id: 'al-6',
      status: 'pending',
      fulfillment: 'pickup',
      requesterId: 'f',
      organizationId: 'org-1',
      items,
    };
    const { svc, manager } = setup(order);
    await svc.updateItems(
      'al-6',
      { items: [{ itemId: 'i-1', quantity: 3, unitPrice: 100 }] },
      owner,
    );
    await svc.updateItems(
      'al-6',
      { items: [{ itemId: 'i-1', quantity: 4, unitPrice: 100 }] },
      owner,
    );
    const notifyCalls = manager.query.mock.calls.filter(
      ([sql]: [string, unknown[]]) => sql.includes('community_notifications'),
    );
    expect(notifyCalls.length).toBe(2);
    expect(notifyCalls[0][1][2]).not.toBe(notifyCalls[1][1][2]);
  });
});

describe('AgrilinkOrdersService.detail', () => {
  it('orders items by itemName at the DB level and strips organizationId/orderId', async () => {
    const order = {
      id: 'al-7',
      code: 'AL-7',
      status: 'completed',
      posRefType: 'order',
      posRefId: 'pos-1',
      requesterId: 'f-1',
      organizationId: 'org-1',
      items: [
        {
          id: 'i-2',
          orderId: 'al-7',
          organizationId: 'org-1',
          itemName: 'Ure',
          quantity: 1,
          unitPrice: 100,
        },
        {
          id: 'i-1',
          orderId: 'al-7',
          organizationId: 'org-1',
          itemName: 'NPK',
          quantity: 2,
          unitPrice: 200,
        },
      ],
    };
    const orderRepo = { findOne: jest.fn().mockResolvedValue(order) };
    const eventRepo = { find: jest.fn().mockResolvedValue([]) };
    const dataSource: any = {
      getRepository: jest.fn((entity: any) =>
        entity.name === 'AgrilinkOrder' ? orderRepo : eventRepo,
      ),
      query: jest
        .fn()
        .mockResolvedValue([{ code: 'DH-1', status: 'completed' }]),
    };
    const svc = new AgrilinkOrdersService(dataSource);
    const result: any = await svc.detail('al-7');
    expect(orderRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'al-7' },
        relations: ['items'],
        order: { items: { itemName: 'ASC' } },
      }),
    );
    for (const item of result.items) {
      expect(item).not.toHaveProperty('organizationId');
      expect(item).not.toHaveProperty('orderId');
    }
    expect(result).not.toHaveProperty('organizationId');
    expect(result).not.toHaveProperty('requesterId');
    expect(result).not.toHaveProperty('posRefType');
    expect(result).not.toHaveProperty('posRefId');
    expect(result.itemCount).toBe(2);
    expect(result).toMatchObject({ voucherTitle: null, voucherRule: null });
  });

  it('exposes the voucher title and rule but not the raw snapshot', async () => {
    const order = {
      id: 'al-8', items: [], discountAmount: 50000, voucherId: 'v-1',
      voucherSnapshot: { title: 'Giảm 5%', type: 'percent', value: 5, maxDiscount: 50000 },
    };
    const dataSource: any = {
      getRepository: jest.fn((entity: any) =>
        entity.name === 'AgrilinkOrder' ? { findOne: jest.fn().mockResolvedValue(order) } : { find: jest.fn().mockResolvedValue([]) },
      ),
    };
    const result: any = await new AgrilinkOrdersService(dataSource).detail('al-8');
    expect(result).toMatchObject({
      discountAmount: 50000,
      voucherTitle: 'Giảm 5%',
      voucherRule: { type: 'percent', value: 5, maxDiscount: 50000 },
    });
    expect(result).not.toHaveProperty('voucherSnapshot');
    expect(result).not.toHaveProperty('voucherId');
  });
});

describe('AgrilinkOrdersService.stats', () => {
  it('computes acceptance rate excluding buyer self-cancel while pending', async () => {
    const { svc } = setup(null);
    (svc as any).dataSource.query = jest.fn().mockResolvedValue([
      {
        new_orders: 10,
        pending: 2,
        in_progress: 3,
        accepted: 6,
        decided: 8,
        buy_revenue: '1500000',
        sell_kg: '80',
        sell_amount: '8000000',
      },
    ]);
    expect(
      await svc.stats(new Date('2026-09-01'), new Date('2026-09-30')),
    ).toEqual({
      newOrders: 10,
      pendingOrders: 2,
      inProgress: 3,
      acceptanceRate: 0.75,
      completedBuyRevenue: 1500000,
      completedSellKg: 80,
      completedSellAmount: 8000000,
    });
  });
});

describe('AgrilinkOrdersService.match', () => {
  it('compares the last 9 digits of the phone number', async () => {
    const { svc } = setup(null);
    (svc as any).dataSource.query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'al-1',
          kind: 'buy',
          contactPhone: '+84 901 234 567',
          requesterId: 'f',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'c-1', name: 'Anh Ba', phone: '0901234567' },
      ]);
    const r = await svc.match('al-1');
    expect(r.suggestions[0].id).toBe('c-1');
    expect((svc as any).dataSource.query.mock.calls[2][1]).toContain(
      '901234567',
    );
  });
});
