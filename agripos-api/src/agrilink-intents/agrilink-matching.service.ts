import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CommunityViewer } from '../community/community.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { AgrilinkIntentsService } from './agrilink-intents.service';
import {
  AcceptIntentOfferDto,
  ChooseIntentDto,
  CreateIntentOfferDto,
} from './dto';
import { calendarDate, validDate, vnToday } from './booking';

@Injectable()
export class AgrilinkMatchingService {
  constructor(
    private readonly db: DataSource,
    private readonly intents: AgrilinkIntentsService,
    private readonly marketplace: MarketplaceService,
  ) {}
  private async intent(id: string) {
    const r = await this.intents.findForMatching(id);
    if (!r || r.status !== 'open')
      throw new NotFoundException('Nhu cầu không còn mở.');
    if (calendarDate(r.windowEnd) < vnToday())
      throw new ConflictException('Tin đã hết hạn.');
    return r;
  }
  private dealer(v: CommunityViewer) {
    if (
      !['owner', 'manager'].includes(v.role) ||
      !v.organizationId ||
      !v.memberships.some((m) => m.id === v.organizationId)
    )
      throw new ForbiddenException('Cần quyền quản lý đại lý.');
    return v.organizationId;
  }
  private async eligible(r: any, org: string) {
    const match = (await this.intents.matches(r, Infinity)).find(
      (m) => m.dealer.id === org,
    );
    if (!match)
      throw new ForbiddenException('Đại lý không phù hợp với nhu cầu này.');
    return match;
  }
  private checkDate(r: any, date?: string, session?: string, required = false) {
    if (required && (!date || !session))
      throw new BadRequestException('Cần chọn ngày và buổi phục vụ.');
    if (
      !!date !== !!session ||
      (date &&
        (!validDate(date) ||
          date < calendarDate(r.windowStart) ||
          date > calendarDate(r.windowEnd))) ||
      (session && !['morning', 'afternoon'].includes(session))
    )
      throw new BadRequestException('Ngày hoặc buổi ngoài khoảng nhu cầu.');
  }
  private kind(r: any, fulfillment: string) {
    if (r.side === 'sell') {
      if (!['delivery', 'at_dealer'].includes(fulfillment))
        throw new BadRequestException('Hình thức không hợp lệ.');
      return fulfillment === 'at_dealer' ? null : 'farm_pickup';
    }
    if (!['pickup', 'delivery'].includes(fulfillment))
      throw new BadRequestException('Hình thức không hợp lệ.');
    return fulfillment === 'delivery' ? 'supply_delivery' : null;
  }
  async createOffer(
    v: CommunityViewer,
    intentId: string,
    dto: CreateIntentOfferDto,
  ) {
    const org = this.dealer(v),
      r = await this.intent(intentId);
    if (r.requesterId === v.id)
      throw new ForbiddenException('Không thể chào giá nhu cầu của mình.');
    const match = await this.eligible(r, org),
      kind = this.kind(r, dto.fulfillment);
    this.checkDate(r, dto.scheduledDate, dto.scheduledSession, !!kind);
    if (
      kind &&
      !(r.side === 'sell' ? match.pickup?.available : match.delivery?.available)
    )
      throw new BadRequestException('Dịch vụ không phục vụ nhu cầu này.');
    if (
      kind &&
      !(
        await this.marketplace.availability(
          org,
          kind,
          dto.scheduledDate!,
          dto.scheduledDate!,
        )
      ).some((s: any) => s.session === dto.scheduledSession)
    )
      throw new ConflictException('Buổi này đã hết chỗ');
    let products: any[] | null = null;
    if (r.side === 'sell') {
      if (dto.pricePerKg == null || dto.products?.length)
        throw new BadRequestException('Cần giá thu mua mỗi kg.');
    } else {
      if (dto.pricePerKg != null || !dto.products?.length)
        throw new BadRequestException('Cần danh sách vật tư.');
      products = dto.products.map((p) => {
        const found = match.products?.find((x) => x.offerId === p.offerId);
        if (!found) throw new BadRequestException('Vật tư không khớp nhu cầu.');
        return {
          offerId: p.offerId,
          name: found.name,
          unit: found.unit,
          price: found.price,
          quantity: p.quantity ?? 1,
        };
      });
      if (new Set(products.map((p) => p.offerId)).size !== products.length)
        throw new BadRequestException('Trùng vật tư.');
    }
    try {
      return await this.db.transaction(async (em) => {
        const [current] = await em.query(
          'SELECT status FROM agrilink_intents WHERE id=$1 FOR UPDATE',
          [intentId],
        );
        if (current?.status !== 'open')
          throw new ConflictException('Nhu cầu đã được xử lý.');
        const [offer] = await em.query(
          `INSERT INTO agrilink_intent_offers(intent_id,organization_id,price_per_kg,products,fulfillment,scheduled_date,scheduled_session,fee_per_kg,message,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,status,price_per_kg::float AS "pricePerKg",products,fulfillment,scheduled_date::text AS "scheduledDate",scheduled_session AS "scheduledSession",fee_per_kg::float AS "feePerKg",message,created_at AS "createdAt"`,
          [
            intentId,
            org,
            dto.pricePerKg ?? null,
            products ? JSON.stringify(products) : null,
            dto.fulfillment,
            dto.scheduledDate ?? null,
            dto.scheduledSession ?? null,
            dto.feePerKg ?? 0,
            dto.message?.trim() ?? '',
            v.id,
          ],
        );
        await em.query(
          `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key) VALUES($1,$2,'agrilink_offer',$3) ON CONFLICT DO NOTHING`,
          [r.requesterId, v.id, `agrilink-offer:${offer.id}`],
        );
        return offer;
      });
    } catch (e: any) {
      if (e?.code === '23505')
        throw new ConflictException('Đã có chào giá đang chờ.');
      throw e;
    }
  }
  async leadOffers(v: CommunityViewer, status?: string) {
    const org = this.dealer(v);
    return this.db.query(
      `SELECT o.id,o.intent_id AS "intentId",o.status,o.price_per_kg::float AS "pricePerKg",o.products,o.fulfillment,o.scheduled_date::text AS "scheduledDate",o.scheduled_session AS "scheduledSession",o.fee_per_kg::float AS "feePerKg",o.message,o.created_at AS "createdAt",
      json_build_object('side',i.side,'cropId',i.crop_id,'productQuery',i.product_query,'quantityKg',i.quantity_kg,'provinceCode',i.province_code,'windowStart',i.window_start,'windowEnd',i.window_end) AS intent
      FROM agrilink_intent_offers o JOIN agrilink_intents i ON i.id=o.intent_id WHERE o.organization_id=$1 AND ($2::text IS NULL OR o.status=$2) ORDER BY o.created_at DESC LIMIT 100`,
      [org, status ?? null],
    );
  }
  async withdraw(v: CommunityViewer, id: string) {
    const [offer] = await this.db.query(
      `UPDATE agrilink_intent_offers SET status='withdrawn',updated_at=now() WHERE id=$1 AND organization_id=$2 AND status='pending' RETURNING id,status`,
      [id, this.dealer(v)],
    );
    if (!offer) throw new NotFoundException();
    return offer;
  }
  async decline(v: CommunityViewer, id: string, offerId: string) {
    const r = await this.intent(id);
    if (r.requesterId !== v.id) throw new NotFoundException();
    const [offer] = await this.db.query(
      `UPDATE agrilink_intent_offers SET status='declined',updated_at=now() WHERE id=$1 AND intent_id=$2 AND status='pending' RETURNING id,status,organization_id`,
      [offerId, id],
    );
    if (!offer) throw new NotFoundException();
    await this.notifyDealer(offer.organization_id, v.id, offerId, 'declined');
    return { id: offer.id, status: offer.status };
  }
  private async notifyDealer(
    org: string,
    actor: string,
    offerId: string,
    status: string,
    em?: EntityManager,
  ) {
    const q = (sql: string, params: unknown[]) =>
      em ? em.query(sql, params) : this.db.query(sql, params);
    await q(
      `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key)
      SELECT m.user_id,$2,'agrilink_offer_status',$3 FROM agrilink_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.organization_id=$1 AND m.active AND u.role IN ('owner','manager','cashier') AND m.user_id<>$2 ON CONFLICT DO NOTHING`,
      [org, actor, `agrilink-offer:${offerId}:${status}`],
    );
  }
  async choose(v: CommunityViewer, id: string, dto: ChooseIntentDto) {
    return this.finish(v, id, dto);
  }
  async accept(
    v: CommunityViewer,
    id: string,
    offerId: string,
    dto: AcceptIntentOfferDto,
  ) {
    const [offer] = await this.db.query(
      `SELECT organization_id AS "organizationId",status,price_per_kg::float AS "pricePerKg",products,fulfillment,scheduled_date::text AS "scheduledDate",scheduled_session AS "scheduledSession" FROM agrilink_intent_offers WHERE id=$1 AND intent_id=$2`,
      [offerId, id],
    );
    if (!offer || offer.status !== 'pending') throw new NotFoundException();
    return this.finish(
      v,
      id,
      {
        organizationId: offer.organizationId,
        fulfillment: offer.fulfillment,
        scheduledDate: offer.scheduledDate,
        scheduledSession: offer.scheduledSession,
        items: offer.products?.map((p: any) => ({
          offerId: p.offerId,
          quantity: p.quantity,
        })),
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        address: dto.address,
      },
      offerId,
      offer.pricePerKg,
      new Map(
        (offer.products ?? []).map((p: any) => [p.offerId, Number(p.price)]),
      ),
    );
  }
  private async finish(
    v: CommunityViewer,
    id: string,
    dto: ChooseIntentDto,
    offerId?: string,
    pricePerKg?: number,
    productPrices?: Map<string, number>,
  ) {
    const r = await this.intent(id);
    if (r.requesterId !== v.id) throw new NotFoundException();
    if (v.memberships.some((m) => m.id === dto.organizationId))
      throw new BadRequestException(
        'Không thể tự đặt đơn với đại lý của mình.',
      );
    const match = await this.eligible(r, dto.organizationId),
      kind = this.kind(r, dto.fulfillment);
    this.checkDate(r, dto.scheduledDate, dto.scheduledSession, !!kind);
    if (
      kind &&
      !(r.side === 'sell' ? match.pickup?.available : match.delivery?.available)
    )
      throw new BadRequestException('Dịch vụ không phục vụ nhu cầu này.');
    const items =
      r.side === 'sell'
        ? [{ offerId: match.offer!.offerId, quantity: Number(r.quantityKg) }]
        : (dto.items ?? []).map((i) => ({
            offerId: i.offerId,
            quantity: i.quantity ?? 1,
          }));
    if (
      r.side === 'buy' &&
      (!items.length ||
        items.some(
          (i) => !match.products?.some((p) => p.offerId === i.offerId),
        ))
    )
      throw new BadRequestException('Vật tư không khớp nhu cầu.');
    const orderId = await this.db.transaction(async (em) => {
      const [locked] = await em.query(
        'SELECT id,status FROM agrilink_intents WHERE id=$1 AND requester_id=$2 FOR UPDATE',
        [id, v.id],
      );
      if (locked?.status !== 'open')
        throw new ConflictException('Nhu cầu đã được xử lý.');
      if (offerId) {
        const [o] = await em.query(
          'SELECT id,status FROM agrilink_intent_offers WHERE id=$1 AND intent_id=$2 AND organization_id=$3 FOR UPDATE',
          [offerId, id, dto.organizationId],
        );
        if (o?.status !== 'pending')
          throw new ConflictException('Chào giá không còn hiệu lực.');
      }
      const idOrder = await this.marketplace.placeOrderTx(
        em,
        v,
        dto.organizationId,
        {
          kind: r.side,
          items,
          fulfillment: dto.fulfillment,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          address: dto.address ?? '',
        },
        {
          intentId: id,
          scheduledDate: dto.scheduledDate,
          scheduledSession: dto.scheduledSession,
          cropId: r.side === 'sell' ? r.cropId : undefined,
          pricesOverride:
            offerId && pricePerKg != null
              ? new Map([[items[0].offerId, pricePerKg]])
              : productPrices,
        },
      );
      await em.query(
        `UPDATE agrilink_intents SET status='matched',updated_at=now() WHERE id=$1`,
        [id],
      );
      await em.query(
        `UPDATE agrilink_intent_offers SET status=CASE WHEN id=$2 THEN 'accepted' ELSE 'expired' END,updated_at=now() WHERE intent_id=$1 AND status='pending'`,
        [id, offerId ?? null],
      );
      if (offerId)
        await this.notifyDealer(
          dto.organizationId,
          v.id,
          offerId,
          'accepted',
          em,
        );
      return idOrder;
    });
    const [intent, order] = await Promise.all([
      this.intents.findForMatching(id),
      this.marketplace.myOrder(v, orderId),
    ]);
    return { intent: this.intents.publicIntent(intent), order };
  }
}
