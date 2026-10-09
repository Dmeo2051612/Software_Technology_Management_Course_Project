import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AgrilinkCompleteService } from './agrilink-complete.service';

const owner = { userId: 'u-1', role: 'owner', organizationId: 'org-1' };
const buyOrder = () => ({
  id: 'al-1',
  code: 'AL-20260928-001',
  kind: 'buy',
  status: 'confirmed',
  fulfillment: 'pickup',
  organizationId: 'org-1',
  requesterId: 'farmer-1',
  contactName: 'Anh Ba',
  contactPhone: '0901234567',
  posRefId: null,
});
const buyItems = () => [
  { id: 'i-1', productId: 'p-1', quantity: 2, unitPrice: 350000 },
  { id: 'i-2', productId: 'p-2', quantity: 1, unitPrice: 420000 },
];

function setup(order: any, items: any[]) {
  const manager: any = {
    find: jest.fn().mockResolvedValue(items),
    findOne: jest.fn((entity: any) =>
      Promise.resolve(
        entity.name === 'AgrilinkCustomerLink' ? null : { id: 'c-1' },
      ),
    ),
    save: jest.fn((_e: any, v: any) =>
      Promise.resolve({ id: v.id ?? 'new-id', ...v }),
    ),
    create: jest.fn((_e: any, v: any) => v),
    query: jest.fn().mockResolvedValue([]),
  };
  const dataSource: any = { transaction: jest.fn((cb: any) => cb(manager)) };
  const ordersSvc: any = {
    createInTransaction: jest.fn().mockResolvedValue({
      order: { id: 'pos-1', total: 1120000 },
      warnings: [],
    }),
  };
  const slipsSvc: any = {
    createInTransaction: jest.fn().mockResolvedValue({
      id: 'slip-1',
      totalWeight: 80,
      totalAmount: 8000000,
    }),
  };
  const core: any = {
    lock: jest.fn().mockResolvedValue(order),
    recordEvent: jest.fn(),
    detail: jest.fn().mockResolvedValue({ id: order.id }),
  };
  const svc = new AgrilinkCompleteService(
    dataSource,
    ordersSvc,
    slipsSvc,
    core,
  );
  return { svc, manager, ordersSvc, slipsSvc, core };
}

describe('AgrilinkCompleteService.complete', () => {
  it('sell: a crop-only item (vd sầu riêng) gets a weighing slip with the crop code and joins the store commodities', async () => {
    const order = { ...buyOrder(), kind: 'sell', fulfillment: 'delivery', posRefType: null };
    const item = { id: 'i-crop', cropId: 'durian', commodityType: null, quantity: 80, unitPrice: 65000 };
    const { svc, manager, slipsSvc, core } = setup(order, [item]);
    manager.query.mockImplementation((sql: string) =>
      Promise.resolve(sql.includes('FROM agri_crops') ? [{ code: 'sau-rieng' }] : []),
    );
    await svc.complete('al-1', { party: { createNew: true }, weights: [50, 30], pricePerKg: 65000, paidAmount: 0 }, owner);
    expect(slipsSvc.createInTransaction).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({ commodityType: 'sau-rieng', weights: [50, 30], pricePerKg: 65000 }),
      { source: 'agrilink', agrilinkOrderId: 'al-1' },
    );
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('array_append(commodities'), ['org-1', 'sau-rieng']);
    expect(order).toMatchObject({ status: 'completed', posRefType: 'weighing_slip', posRefId: 'slip-1' });
    expect(core.recordEvent).toHaveBeenCalledWith(manager, order, 'confirmed', 'completed', owner);
  });
  it('buy: creates an AgriPOS order on the same manager with source agrilink', async () => {
    const order = buyOrder();
    const { svc, manager, ordersSvc, core } = setup(order, buyItems());
    await svc.complete(
      'al-1',
      {
        party: { customerId: 'c-1' },
        paymentMethod: 'debt',
        paidAmount: 0,
        items: [
          { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
          { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
        ],
      },
      owner,
    );
    expect(ordersSvc.createInTransaction).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        customerId: 'c-1',
        paymentMethod: 'debt',
        paidAmount: 0,
        items: [
          { productId: 'p-1', quantity: 2, unitPrice: 350000 },
          { productId: 'p-2', quantity: 1, unitPrice: 420000 },
        ],
      }),
      'u-1',
      { source: 'agrilink', agrilinkOrderId: 'al-1' },
    );
    expect(order).toMatchObject({
      status: 'completed',
      posRefType: 'order',
      posRefId: 'pos-1',
      finalTotal: 1120000,
    });
    expect(core.recordEvent).toHaveBeenCalledWith(
      manager,
      order,
      'confirmed',
      'completed',
      owner,
    );
  });

  it('buy: saves the customer link for next time with an atomic upsert', async () => {
    const { svc, manager } = setup(buyOrder(), buyItems());
    await svc.complete(
      'al-1',
      {
        party: { customerId: 'c-1' },
        paymentMethod: 'cash',
        paidAmount: 1120000,
        items: [
          { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
          { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
        ],
      },
      owner,
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      ['org-1', 'farmer-1', 'c-1', null],
    );
    const [sql] = manager.query.mock.calls.find(([s]: [string]) =>
      s.includes('agrilink_customer_links'),
    )!;
    expect(sql).toContain(
      '"customerId"=COALESCE(EXCLUDED."customerId", agrilink_customer_links."customerId")',
    );
    expect(sql).toContain(
      '"farmerId"=COALESCE(EXCLUDED."farmerId", agrilink_customer_links."farmerId")',
    );
  });

  it('buy: createNew makes a customer from the contact snapshot', async () => {
    const { svc, manager, ordersSvc } = setup(buyOrder(), buyItems());
    await svc.complete(
      'al-1',
      {
        party: { createNew: true },
        paymentMethod: 'cash',
        paidAmount: 1120000,
        items: [
          { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
          { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
        ],
      },
      owner,
    );
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Anh Ba', phone: '0901234567' }),
    );
    expect(ordersSvc.createInTransaction.mock.calls[0][1].customerId).toBe(
      'new-id',
    );
  });

  it('buy: recomputes the voucher on the final lines and books it as the POS order discount', async () => {
    const order = {
      ...buyOrder(),
      voucherId: 'v-1',
      voucherSnapshot: { title: 'Giảm 5%', type: 'percent', value: 5, maxDiscount: 50000 },
      discountAmount: 50000,
    };
    const { svc, ordersSvc } = setup(order, buyItems());
    ordersSvc.createInTransaction.mockResolvedValue({ order: { id: 'pos-1', total: 684000 }, warnings: [] });
    const lines = [
      { itemId: 'i-1', quantity: 1, unitPrice: 300000 },
      { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
    ];
    // Tổng chốt 720.000 → 5% = 36.000 (dưới trần 50.000); khách trả tối đa 684.000.
    await expect(
      svc.complete('al-1', { party: { customerId: 'c-1' }, paymentMethod: 'cash', paidAmount: 700000, items: lines }, owner),
    ).rejects.toThrow('Số tiền trả vượt tổng đơn.');
    await svc.complete('al-1', { party: { customerId: 'c-1' }, paymentMethod: 'cash', paidAmount: 684000, items: lines }, owner);
    expect(ordersSvc.createInTransaction.mock.calls[0][1]).toMatchObject({ discount: 36000, paidAmount: 684000 });
    expect(order).toMatchObject({ discountAmount: 36000, finalTotal: 684000 });
  });

  it('buy: sends no discount for an order without a voucher', async () => {
    const { svc, ordersSvc } = setup(buyOrder(), buyItems());
    await svc.complete(
      'al-1',
      {
        party: { customerId: 'c-1' },
        paymentMethod: 'cash',
        paidAmount: 0,
        items: [
          { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
          { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
        ],
      },
      owner,
    );
    expect(ordersSvc.createInTransaction.mock.calls[0][1].discount).toBe(0);
  });

  it('buy: rejects paidAmount above the total and missing lines', async () => {
    const { svc } = setup(buyOrder(), buyItems());
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 9e9,
          items: [
            { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
            { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
          ],
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
          items: [{ itemId: 'i-1', quantity: 2, unitPrice: 350000 }],
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('buy: rejects a computed total above the money bound', async () => {
    const { svc } = setup(buyOrder(), buyItems());
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
          items: [
            { itemId: 'i-1', quantity: 999999999, unitPrice: 9999999999 },
            { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
          ],
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('sell: rejects a computed amount above the money bound', async () => {
    const order = { ...buyOrder(), kind: 'sell', fulfillment: 'at_dealer' };
    const items = [
      {
        id: 'i-9',
        productId: null,
        commodityType: 'pepper',
        quantity: 100,
        unitPrice: 100000,
      },
    ];
    const { svc } = setup(order, items);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { farmerId: 'f-1' },
          weights: [1000000],
          pricePerKg: 9999999999,
          paidAmount: 0,
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('buy: rejects duplicate itemIds in the completion payload', async () => {
    const singleItem = [
      { id: 'i-1', productId: 'p-1', quantity: 2, unitPrice: 350000 },
    ];
    const { svc } = setup(buyOrder(), singleItem);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
          items: [
            { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
            { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
          ],
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('buy: rejects an item with no linked product', async () => {
    const items = [
      { id: 'i-1', productId: null, quantity: 2, unitPrice: 350000 },
    ];
    const { svc } = setup(buyOrder(), items);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
          items: [{ itemId: 'i-1', quantity: 2, unitPrice: 350000 }],
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('sell: rejects an order with more than one item', async () => {
    const order = { ...buyOrder(), kind: 'sell', fulfillment: 'at_dealer' };
    const items = [
      {
        id: 'i-9',
        productId: null,
        commodityType: 'pepper',
        quantity: 50,
        unitPrice: 100000,
      },
      {
        id: 'i-10',
        productId: null,
        commodityType: 'pepper',
        quantity: 30,
        unitPrice: 100000,
      },
    ];
    const { svc } = setup(order, items);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { farmerId: 'f-1' },
          weights: [50],
          pricePerKg: 100000,
          paidAmount: 0,
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an order already written to AgriPOS', async () => {
    const { svc } = setup({ ...buyOrder(), posRefId: 'pos-x' }, buyItems());
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
        } as any,
        owner,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('cashier cannot complete a delivery order', async () => {
    const { svc } = setup(
      { ...buyOrder(), status: 'delivering', fulfillment: 'delivery' },
      buyItems(),
    );
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'cash',
          paidAmount: 0,
        } as any,
        { ...owner, role: 'cashier' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('propagates AgriPOS errors (e.g. debt limit) without marking completed', async () => {
    const order = buyOrder();
    const { svc, ordersSvc } = setup(order, buyItems());
    ordersSvc.createInTransaction.mockRejectedValue(
      new BadRequestException('Khách hàng vượt hạn mức công nợ.'),
    );
    await expect(
      svc.complete(
        'al-1',
        {
          party: { customerId: 'c-1' },
          paymentMethod: 'debt',
          paidAmount: 0,
          items: [
            { itemId: 'i-1', quantity: 2, unitPrice: 350000 },
            { itemId: 'i-2', quantity: 1, unitPrice: 420000 },
          ],
        },
        owner,
      ),
    ).rejects.toThrow('vượt hạn mức');
    expect(order.status).toBe('confirmed');
  });

  it('sell: creates a weighing slip for the linked farmer', async () => {
    const order = { ...buyOrder(), kind: 'sell', fulfillment: 'at_dealer' };
    const items = [
      {
        id: 'i-9',
        productId: null,
        commodityType: 'pepper',
        quantity: 100,
        unitPrice: 100000,
      },
    ];
    const { svc, manager, slipsSvc } = setup(order, items);
    await svc.complete(
      'al-1',
      {
        party: { farmerId: 'f-1' },
        weights: [50, 30],
        pricePerKg: 100000,
        paidAmount: 0,
        weighDate: '2026-09-28',
      },
      owner,
    );
    expect(slipsSvc.createInTransaction).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        commodityType: 'pepper',
        farmerId: 'f-1',
        weights: [50, 30],
        pricePerKg: 100000,
        paidAmount: 0,
      }),
      { source: 'agrilink', agrilinkOrderId: 'al-1' },
    );
    expect(order).toMatchObject({
      status: 'completed',
      posRefType: 'weighing_slip',
      posRefId: 'slip-1',
      finalTotal: 8000000,
    });
    expect(items[0]).toMatchObject({
      finalQuantity: 80,
      finalUnitPrice: 100000,
    });
  });

  it('sell: legacy offer without commodity type is rejected', async () => {
    const order = { ...buyOrder(), kind: 'sell', fulfillment: 'at_dealer' };
    const { svc } = setup(order, [
      {
        id: 'i-9',
        productId: null,
        commodityType: null,
        quantity: 1,
        unitPrice: 1,
      },
    ]);
    await expect(
      svc.complete(
        'al-1',
        {
          party: { farmerId: 'f-1' },
          weights: [1],
          pricePerKg: 1,
          paidAmount: 0,
        },
        owner,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
