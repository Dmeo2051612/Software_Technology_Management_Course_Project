import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OrdersService } from '../orders/orders.service';
import { PaymentMethod } from '../orders/entities/order.entity';
import { WeighingSlipsService } from '../weighing-slips/weighing-slips.service';
import { Customer } from '../customers/entities/customer.entity';
import { Farmer } from '../farmers/entities/farmer.entity';
import { AgrilinkOrder } from './entities/agrilink-order.entity';
import { AgrilinkOrderItem } from './entities/agrilink-order-item.entity';
import { AgrilinkOrdersService, ManageUser } from './agrilink-orders.service';
import { CompleteOrderDto, PartyDto } from './dto/manage.dto';
import { nextStatus } from './order-state';
import { vnDateStamp } from './order-code';
import { phoneDigits, phoneDigitsSql } from '../customers/place';
import { voucherDiscount } from '../marketplace/voucher-rules';

/**
 * Completes an AgriLink order by matching/creating the POS party (customer or
 * farmer), applying final quantities/prices, and creating the corresponding
 * order or weighing slip — all in the same transaction as the status change.
 */
@Injectable()
export class AgrilinkCompleteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly slips: WeighingSlipsService,
    private readonly core: AgrilinkOrdersService,
  ) {}

  async complete(id: string, dto: CompleteOrderDto, user: ManageUser) {
    await this.dataSource.transaction(async (m) => {
      const order = await this.core.lock(m, id);
      const from = order.status;
      const to = nextStatus(order, 'complete', {
        side: 'dealer',
        role: user.role,
      });
      if (order.posRefId)
        throw new ConflictException('Đơn đã được ghi sang AgriPOS.');
      const items = await m.find(AgrilinkOrderItem, { where: { orderId: id } });

      if (order.kind === 'buy') {
        if (!dto.items || !dto.paymentMethod)
          throw new BadRequestException(
            'Thiếu dòng hàng hoặc phương thức thanh toán.',
          );
        if (dto.items.length !== items.length)
          throw new BadRequestException(
            'Cần chốt đủ tất cả dòng hàng của đơn.',
          );
        const edits = new Map(dto.items.map((e) => [e.itemId, e]));
        if (items.some((i) => !edits.has(i.id)))
          throw new BadRequestException(
            'Cần chốt đủ tất cả dòng hàng của đơn.',
          );
        if (items.some((i) => i.productId == null))
          throw new BadRequestException(
            'Dòng hàng chưa liên kết sản phẩm — hãy tạo lại tin đăng.',
          );
        const total = items.reduce(
          (s, i) =>
            s +
            Math.round(edits.get(i.id)!.quantity * edits.get(i.id)!.unitPrice),
          0,
        );
        if (total > 9_999_999_999_999)
          throw new BadRequestException('Tổng tiền vượt giới hạn.');
        const discount = order.voucherSnapshot ? voucherDiscount(order.voucherSnapshot, total) : 0;
        if (dto.paidAmount > total - discount)
          throw new BadRequestException('Số tiền trả vượt tổng đơn.');
        const customerId = await this.resolveParty(
          m,
          order,
          dto.party,
          'customer',
        );
        const { order: pos } = await this.orders.createInTransaction(
          m,
          {
            customerId,
            paymentMethod: dto.paymentMethod as PaymentMethod,
            paidAmount: dto.paidAmount,
            discount,
            note: `AgriLink ${order.code}`,
            items: items.map((i) => ({
              productId: i.productId!,
              quantity: edits.get(i.id)!.quantity,
              unitPrice: edits.get(i.id)!.unitPrice,
            })),
          },
          user.userId,
          { source: 'agrilink', agrilinkOrderId: order.id },
        );
        for (const i of items) {
          i.finalQuantity = edits.get(i.id)!.quantity;
          i.finalUnitPrice = edits.get(i.id)!.unitPrice;
          await m.save(AgrilinkOrderItem, i);
        }
        Object.assign(order, {
          finalTotal: pos.total,
          discountAmount: discount,
          posRefType: 'order',
          posRefId: pos.id,
        });
      } else {
        if (items.length !== 1)
          throw new BadRequestException(
            'Đơn bán nông sản chỉ gồm một loại nông sản.',
          );
        const item = items[0];
        if (!item?.commodityType && !item?.cropId)
          throw new BadRequestException(
            'Tin thu mua cũ chưa có loại nông sản — hãy tạo lại tin thu mua.',
          );
        if (!dto.weights?.length || dto.pricePerKg == null)
          throw new BadRequestException('Cần nhập các lần cân và giá/kg.');
        const amount = Math.round(
          dto.weights.reduce((s, w) => s + w, 0) * dto.pricePerKg,
        );
        if (amount > 9_999_999_999_999)
          throw new BadRequestException('Tổng tiền vượt giới hạn.');
        if (dto.paidAmount > amount)
          throw new BadRequestException(
            'Số tiền trả vượt thành tiền phiếu cân.',
          );
        // Mã nông sản trong kho AgriPOS: mã gốc cà phê/tiêu, còn lại theo agri_crops.code (lua, san…).
        let commodityKey = item.commodityType;
        if (!commodityKey && item.cropId) {
          const rows: { code: string }[] = await m.query(
            'SELECT code FROM agri_crops WHERE id=$1',
            [item.cropId],
          );
          commodityKey = rows[0]?.code ?? null;
        }
        if (!commodityKey) throw new BadRequestException('Không xác định được nông sản của tin thu mua.');
        // Nông sản mới với cửa hàng → thêm vào danh sách thu mua để hiện trong phiếu cân, tồn kho.
        await m.query(
          `UPDATE store_settings SET commodities=array_append(commodities,$2)
           WHERE "organizationId"=$1 AND NOT ($2=ANY(commodities))`,
          [order.organizationId, commodityKey],
        );
        {
        const farmerId = await this.resolveParty(m, order, dto.party, 'farmer');
        const slip = await this.slips.createInTransaction(
          m,
          {
            commodityType: commodityKey,
            farmerId,
            weighDate:
              dto.weighDate ??
              vnDateStamp().replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'),
            weights: dto.weights,
            pricePerKg: dto.pricePerKg,
            paidAmount: dto.paidAmount,
            note: `AgriLink ${order.code}`,
          },
          { source: 'agrilink', agrilinkOrderId: order.id },
        );
        item.finalQuantity = Number(slip.totalWeight);
        item.finalUnitPrice = dto.pricePerKg;
        await m.save(AgrilinkOrderItem, item);
        Object.assign(order, {
          finalTotal: Number(slip.totalAmount),
          posRefType: 'weighing_slip',
          posRefId: slip.id,
        });
        }
      }

      order.status = to;
      order.completedAt = new Date();
      await m.save(AgrilinkOrder, order);
      await this.core.recordEvent(m, order, from, to, user);
      await m.query(`INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key) VALUES($1,$2,'agrilink_rate',$3) ON CONFLICT DO NOTHING`, [order.requesterId,user.userId,`agrilink-rate:${order.id}`]);
    });
    return this.core.detail(id);
  }

  private async resolveParty(
    m: EntityManager,
    order: AgrilinkOrder,
    party: PartyDto,
    kind: 'customer' | 'farmer',
  ): Promise<string> {
    const Entity = kind === 'customer' ? Customer : Farmer;
    const chosen = kind === 'customer' ? party.customerId : party.farmerId;
    let partyId: string;
    if (chosen) {
      const found = await m.findOne(Entity as any, { where: { id: chosen } });
      if (!found)
        throw new NotFoundException(
          kind === 'customer'
            ? 'Không tìm thấy khách hàng.'
            : 'Không tìm thấy nông dân.',
        );
      partyId = chosen;
    } else if (party.createNew) {
      // Số điện thoại đã có người trong sổ → dùng lại, không tạo bản trùng (DB cũng chặn trùng số)
      const digits = phoneDigits(order.contactPhone);
      const table = kind === 'customer' ? 'customers' : 'farmers';
      const [same] = digits
        ? await m.query(`SELECT id FROM ${table} t WHERE t."isActive" AND ${phoneDigitsSql('t')} = $1 LIMIT 1`, [digits])
        : [];
      if (same) {
        partyId = same.id;
      } else {
        const toCreate: any = m.create(Entity as any, {
          name: order.contactName,
          phone: order.contactPhone,
        });
        const saved: any = await m.save(Entity as any, toCreate);
        partyId = saved.id;
      }
    } else {
      throw new BadRequestException('Hãy chọn khách/nông dân hoặc tạo mới.');
    }
    // Atomic upsert instead of find-then-save: two concurrent completions for
    // the same requester (one a customer link, one a farmer link) must not
    // race and drop one side — COALESCE only overwrites the side we resolved.
    await m.query(
      `INSERT INTO agrilink_customer_links("organizationId","userId","customerId","farmerId")
       VALUES($1,$2,$3,$4)
       ON CONFLICT("organizationId","userId") DO UPDATE SET
         "customerId"=COALESCE(EXCLUDED."customerId", agrilink_customer_links."customerId"),
         "farmerId"=COALESCE(EXCLUDED."farmerId", agrilink_customer_links."farmerId")`,
      [
        order.organizationId,
        order.requesterId,
        kind === 'customer' ? partyId : null,
        kind === 'farmer' ? partyId : null,
      ],
    );
    return partyId;
  }
}
