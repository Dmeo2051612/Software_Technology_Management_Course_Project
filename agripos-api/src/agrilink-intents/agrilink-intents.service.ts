import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { validateLocation } from '../agri-reference/location';
import { AgriReferenceService } from '../agri-reference/agri-reference.service';
import { AgrilinkTrustService } from '../marketplace/agrilink-trust.service';
import { BUY_OFFER_STALE_HOURS, priceFreshness, vsMarketPct } from '../marketplace/trust-pricing';
import { normalizeVi } from '../agri-reference/normalize';
import {
  CommunityService,
  CommunityViewer,
} from '../community/community.service';
import { CreateIntentDto, LeadsQuery } from './dto';
import { MATCH_EXPLAINER } from './explainer';
import type { MatchExplainer } from './explainer';
import { INTENT_PARSER } from './parser/intent-parser';
import type { IntentParser } from './parser/intent-parser';
import { Candidate, IntentForMatch, scoreCandidates, Service } from './scoring';
import { calendarDate } from './booking';
import { saleOfferSql } from '../marketplace/sale-offer-sql';
import { buyNoMatch, NoMatch, sellNoMatch } from './near-match';

const vnDate = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
const dateString = (v: string | Date) =>
  calendarDate(v);
const service = (row: any): Service | null =>
  row
    ? {
        active: row.active,
        cropIds: row.cropIds ?? [],
        areaMode: row.areaMode,
        radiusKm: row.radiusKm,
        provinceCodes: row.provinceCodes ?? [],
        feeMode: row.feeMode,
        feeAmount: Number(row.feeAmount),
        minQuantityKg: Number(row.minQuantityKg),
        leadTimeHours: row.leadTimeHours,
        windows: row.windows ?? [],
        bookings: row.bookings ?? [],
      }
    : null;

@Injectable()
export class AgrilinkIntentsService {
  constructor(
    private readonly db: DataSource,
    private readonly community: CommunityService,
    @Inject(INTENT_PARSER) private readonly parser: IntentParser,
    @Inject(MATCH_EXPLAINER) private readonly explainer: MatchExplainer,
    @Optional() private readonly trust?: AgrilinkTrustService,
    @Optional() private readonly reference?: AgriReferenceService,
  ) {}

  viewer(id: string) {
    return this.community.viewer(id);
  }
  async parse(v: CommunityViewer, text: string) {
    const [p] = await this.db.query(
      'SELECT province_code,commune_code FROM community_profiles WHERE user_id=$1',
      [v.id],
    );
    return this.parser.parse(text, {
      now: new Date(),
      defaultProvinceCode: p?.province_code ?? undefined,
      defaultCommuneCode: p?.commune_code ?? undefined,
    });
  }
  private async row(id: string) {
    const [r] = await this.db.query(
      `SELECT i.id,i.requester_id AS "requesterId",i.side,i.status,i.raw_text AS "rawText",
      i.crop_id AS "cropId",c.name AS "cropName",i.product_query AS "productQuery",i.quantity_kg::float AS "quantityKg",
      i.quantity_text AS "quantityText",i.province_code AS "provinceCode",p.name AS "provinceName",
       i.commune_code AS "communeCode",a.name AS "communeName",i.window_start::text AS "windowStart",i.window_end::text AS "windowEnd",
      i.expected_price_per_kg::float AS "expectedPricePerKg",i.fulfillment_pref AS "fulfillmentPref",i.note,
      i.parser,i.parse_confidence::float AS "parseConfidence",i.created_at AS "createdAt",i.updated_at AS "updatedAt",
      COALESCE(a.lat,p.lat)::float AS lat,COALESCE(a.lng,p.lng)::float AS lng
      FROM agrilink_intents i JOIN admin_provinces p ON p.code=i.province_code
      LEFT JOIN admin_communes a ON a.code=i.commune_code LEFT JOIN agri_crops c ON c.id=i.crop_id WHERE i.id=$1`,
      [id],
    );
    return r;
  }
  async create(v: CommunityViewer, dto: CreateIntentDto) {
    await this.validateIntent(dto);
    return this.insertIntent(v, dto);
  }
  /** Đại lý phù hợp với nhu cầu chưa lưu: không ghi nhu cầu, không báo cho đại lý. */
  async preview(v: CommunityViewer, dto: CreateIntentDto) {
    await this.validateIntent(dto);
    const [place] = await this.db.query(
      `SELECT COALESCE(a.lat,p.lat)::float AS lat,COALESCE(a.lng,p.lng)::float AS lng
      FROM admin_provinces p LEFT JOIN admin_communes a ON a.code=$2 WHERE p.code=$1`,
      [dto.provinceCode, dto.communeCode ?? null],
    );
    const r = {
      requesterId: v.id,
      side: dto.side,
      cropId: dto.side === 'sell' ? dto.cropId : null,
      productQuery: dto.side === 'buy' ? normalizeVi(dto.productQuery!) : null,
      quantityKg: dto.quantityKg ?? null,
      provinceCode: dto.provinceCode,
      windowStart: dto.windowStart,
      windowEnd: dto.windowEnd,
      fulfillmentPref: dto.fulfillmentPref,
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
    };
    const matches = await this.matches(r);
    if (matches.length) return { matches };
    return { matches, noMatch: await this.noMatch({ ...r, productQuery: dto.productQuery?.trim() ?? null }) };
  }
  /**
   * Không có đại lý đủ điều kiện: lý do và đại lý gần phù hợp (giá cũ, hết hạn, ở xa, nông sản cùng nhóm,
   * sản phẩm khớp một phần). Chỉ đọc, không lưu gì.
   */
  async noMatch(r: any): Promise<NoMatch> {
    const intent = this.toMatch({ ...r, productQuery: r.productQuery });
    const area = (kind: string) =>
      `(SELECT json_build_object('areaMode',s.area_mode,'radiusKm',s.radius_km::float,'provinceCodes',s.province_codes)
        FROM agrilink_dealer_services s WHERE s.organization_id=o.id AND s.kind='${kind}' AND s.active LIMIT 1)`;
    const dealer = `o.id,o.name,o.logo_url AS "logoUrl",p.name AS "provinceName",ec.lat::float AS lat,ec.lng::float AS lng,
      EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified') AS verified`;
    const others = `o.marketplace_enabled AND NOT EXISTS(SELECT 1 FROM agrilink_memberships m WHERE m.organization_id=o.id AND m.user_id=$1 AND m.active)`;
    if (r.side === 'sell') {
      const [crop] = await this.db.query('SELECT name,grp FROM agri_crops WHERE id=$1', [r.cropId]);
      const rows = await this.db.query(
        `SELECT ${dealer},f.title,f.crop_id AS "cropId",c.name AS "cropName",f.price::float AS price,f.unit,
        f.max_quantity_kg::float AS "maxQuantityKg",f.price_updated_at AS "priceUpdatedAt",f.valid_until::text AS "validUntil",${area('farm_pickup')} AS pickup
        FROM agrilink_offers f JOIN agri_crops c ON c.id=f.crop_id JOIN agrilink_organizations o ON o.id=f.organization_id
        JOIN agrilink_effective_coords ec ON ec.organization_id=o.id LEFT JOIN admin_provinces p ON p.code=o.province_code
        WHERE f.kind='buy' AND f.active AND ${others} AND (f.crop_id=$2 OR c.grp=$3) LIMIT 300`,
        [r.requesterId, r.cropId, crop?.grp ?? null],
      );
      return sellNoMatch(intent, crop?.name ?? 'nông sản này', rows, new Date());
    }
    const sale = saleOfferSql('f', 'q');
    const rows = await this.db.query(
      `SELECT ${dealer},${sale.name} AS "productName",(${sale.price})::float AS price,${sale.unit} AS unit,(q."stockQuantity">0) AS "inStock",${area('supply_delivery')} AS delivery
      FROM agrilink_offers f JOIN products q ON q.id=f.product_id AND q."organizationId"=f.organization_id
      JOIN agrilink_organizations o ON o.id=f.organization_id JOIN agrilink_effective_coords ec ON ec.organization_id=o.id
      LEFT JOIN admin_provinces p ON p.code=o.province_code
      WHERE f.kind='sale' AND f.active AND q."isActive" AND ${others} LIMIT 3000`,
      [r.requesterId],
    );
    return buyNoMatch(intent, rows);
  }
  private async validateIntent(dto: CreateIntentDto) {
    if (dto.side === 'sell' && (!dto.cropId || !dto.quantityKg))
      throw new BadRequestException('Cần cây trồng và khối lượng để bán.');
    if (
      dto.side === 'buy' &&
      (!dto.productQuery || normalizeVi(dto.productQuery).length < 2)
    )
      throw new BadRequestException('Cần tên vật tư để mua.');
    const today = vnDate(),
      start = new Date(`${dto.windowStart}T00:00:00Z`),
      end = new Date(`${dto.windowEnd}T00:00:00Z`);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      dateString(start) !== dto.windowStart ||
      dateString(end) !== dto.windowEnd
    )
      throw new BadRequestException('Ngày không hợp lệ.');
    if (
      dto.windowStart < today ||
      end < start ||
      (end.getTime() - start.getTime()) / 86400000 > 60
    )
      throw new BadRequestException(
        'Khoảng ngày phải hợp lệ, không quá 60 ngày và không ở quá khứ.',
      );
    await validateLocation(
      this.db,
      { provinceCode: null, communeCode: null },
      { provinceCode: dto.provinceCode, communeCode: dto.communeCode ?? null },
    );
    if (dto.cropId) {
      const [crop] = await this.db.query(
        'SELECT id FROM agri_crops WHERE id=$1 AND active',
        [dto.cropId],
      );
      if (!crop) throw new BadRequestException('Cây trồng không hợp lệ.');
    }
  }
  private async insertIntent(v: CommunityViewer, dto: CreateIntentDto) {
    const parsed = await this.parse(v, dto.rawText);
    const [inserted] = await this.db.query(
      `INSERT INTO agrilink_intents(requester_id,side,raw_text,crop_id,product_query,quantity_kg,quantity_text,province_code,commune_code,window_start,window_end,expected_price_per_kg,fulfillment_pref,note,parse_confidence,parser)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [
        v.id,
        dto.side,
        dto.rawText.trim(),
        dto.side === 'sell' ? dto.cropId : null,
        dto.side === 'buy' ? normalizeVi(dto.productQuery!) : null,
        dto.quantityKg ?? null,
        dto.quantityText?.trim() ?? '',
        dto.provinceCode,
        dto.communeCode ?? null,
        dto.windowStart,
        dto.windowEnd,
        dto.expectedPricePerKg ?? null,
        dto.fulfillmentPref,
        dto.note?.trim() ?? '',
        parsed.confidence,
        parsed.parser,
      ],
    );
    const intent = await this.row(inserted.id);
    const matches = await this.matches(intent);
    for (const match of matches) {
      await this.db.query(
        `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key)
        SELECT m.user_id,$2,'agrilink_lead',$3 FROM agrilink_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=$1 AND m.active AND u.role IN ('owner','manager') AND m.user_id<>$2 ON CONFLICT DO NOTHING`,
        [
          match.dealer.id,
          v.id,
          `agrilink-lead:${intent.id}:${match.dealer.id}`,
        ],
      );
    }
    return { intent: this.publicIntent(intent), matches };
  }
  publicIntent(r: any) {
    const { lat, lng, ...rest } = r;
    return { ...rest, windowStart: dateString(r.windowStart), windowEnd: dateString(r.windowEnd) };
  }
  private toMatch(r: any): IntentForMatch {
    return {
      requesterId: r.requesterId,
      side: r.side,
      cropId: r.cropId,
      productQuery: r.productQuery,
      quantityKg: r.quantityKg,
      provinceCode: r.provinceCode,
      windowStart: dateString(r.windowStart),
      windowEnd: dateString(r.windowEnd),
      fulfillmentPref: r.fulfillmentPref,
      lat: r.lat,
      lng: r.lng,
    };
  }
  async matches(r: any, limit = 5) {
    const intent = this.toMatch(r);
    const rows = await this.db.query(
      `SELECT o.id,o.name,o.logo_url AS "logoUrl",p.name AS "provinceName",ec.lat::float AS lat,ec.lng::float AS lng,
      (SELECT count(*)::int FROM agrilink_orders ao WHERE ao."organizationId"=o.id AND ao.status='completed' AND ao."completedAt">=now()-interval '180 days') AS "completedOrders",
      f.id AS "offerId",f.price::float AS price,f.unit,f.max_quantity_kg::float AS "maxQuantityKg",f.price_updated_at AS "priceUpdatedAt",
      EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified') AS verified
      FROM agrilink_organizations o JOIN agrilink_effective_coords ec ON ec.organization_id=o.id
      LEFT JOIN admin_provinces p ON p.code=o.province_code
      LEFT JOIN agrilink_offers f ON f.organization_id=o.id AND f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $5) AND f.crop_id=$2 AND (f.valid_until IS NULL OR f.valid_until >= $3::date)
      WHERE o.marketplace_enabled AND NOT EXISTS(SELECT 1 FROM agrilink_memberships m WHERE m.organization_id=o.id AND m.user_id=$1 AND m.active)
      AND ($4='buy' OR f.id IS NOT NULL)`,
      [r.requesterId, r.cropId, dateString(r.windowStart), r.side, BUY_OFFER_STALE_HOURS],
    );
    const orgIds = rows.map((x: any) => x.id);
    if (!orgIds.length) return [];
    const ratings = await this.trust?.aggregatesFor(orgIds) ?? new Map();
    const market = r.side === 'sell' && r.cropId ? await this.reference?.marketPrice(r.cropId,r.provinceCode) ?? null : null;
    const services = await this.db.query(
      `SELECT s.organization_id AS "organizationId",s.kind,s.active,s.crop_ids AS "cropIds",s.area_mode AS "areaMode",s.radius_km AS "radiusKm",s.province_codes AS "provinceCodes",s.fee_mode AS "feeMode",s.fee_amount::float AS "feeAmount",s.min_quantity_kg::float AS "minQuantityKg",s.lead_time_hours AS "leadTimeHours",
      COALESCE((SELECT json_agg(json_build_object('weekday',w.weekday,'session',w.session,'capacity',w.capacity) ORDER BY w.weekday,w.session) FROM agrilink_service_windows w WHERE w.service_id=s.id),'[]'::json) AS windows,
      COALESCE((SELECT json_agg(json_build_object('date',b.booking_date::text,'session',b.session,'used',b.used)) FROM
        (SELECT booking_date,session,count(*)::int AS used FROM agrilink_service_bookings
         WHERE service_id=s.id AND status='active' AND booking_date BETWEEN $2::date AND $3::date GROUP BY booking_date,session) b),'[]'::json) AS bookings
      FROM agrilink_dealer_services s WHERE s.organization_id=ANY($1::uuid[]) AND s.active`,
      [orgIds, dateString(r.windowStart), dateString(r.windowEnd)],
    );
    const sale = saleOfferSql('f', 'p');
    const products =
      r.side === 'buy'
        ? await this.db.query(
            `SELECT f.organization_id AS "organizationId",f.id AS "offerId",${sale.name} AS name,${sale.unit} AS unit,(${sale.price})::float AS price,(p."stockQuantity">0) AS "inStock"
      FROM agrilink_offers f JOIN products p ON p.id=f.product_id AND p."organizationId"=f.organization_id
      WHERE f.organization_id=ANY($1::uuid[]) AND f.kind='sale' AND f.active AND p."isActive" ORDER BY f.organization_id,${sale.name}`,
            [orgIds],
          )
        : [];
    const candidates: Candidate[] = rows.map((x: any) => ({
      dealer: {
        id: x.id,
        name: x.name,
        logoUrl: x.logoUrl,
        provinceName: x.provinceName,
        verified: x.verified,
      },
      lat: x.lat,
      lng: x.lng,
      completedOrders: x.completedOrders,
      ratings: ratings.get(x.id),
      offer: x.offerId
        ? {
            offerId: x.offerId,
            price: x.price,
            unit: x.unit,
            maxQuantityKg: x.maxQuantityKg,
            priceUpdatedAt: x.priceUpdatedAt,
            priceFreshness: priceFreshness(x.priceUpdatedAt),
          }
        : undefined,
      products: products
        .filter((p: any) => p.organizationId === x.id)
        .map((p: any) => ({
          offerId: p.offerId,
          name: p.name,
          unit: p.unit,
          price: p.price,
          inStock: p.inStock,
        })),
      pickup: service(
        services.find(
          (s: any) => s.organizationId === x.id && s.kind === 'farm_pickup',
        ),
      ),
      delivery: service(
        services.find(
          (s: any) => s.organizationId === x.id && s.kind === 'supply_delivery',
        ),
      ),
    }));
    return scoreCandidates(intent, candidates, new Date(), limit).map((m) => {
      m.market = market;
      m.vsMarketPct = m.offer ? vsMarketPct(m.offer.price,market) : null;
      const { lat, lng, completedOrders, ...out } = m;
      return {
        ...out,
        score: Math.round(m.score * 100) / 100,
        distanceKm:
          m.distanceKm === null ? null : Math.round(m.distanceKm * 10) / 10,
        reasons: this.explainer.explain(intent, m),
      };
    });
  }
  async mine(v: CommunityViewer, status?: string) {
    const rows = await this.db.query(
      'SELECT id FROM agrilink_intents WHERE requester_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 100',
      [v.id, status ?? null],
    );
    return Promise.all(
      rows.map(async (x: any) => {
        const r = await this.row(x.id);
        return {
          ...this.publicIntent(r),
          matchCount: (await this.matches(r)).length,
        };
      }),
    );
  }
  async findForMatching(id: string) { return this.row(id); }
  async detail(v: CommunityViewer, id: string) {
    const r = await this.row(id);
    if (!r || r.requesterId !== v.id) throw new NotFoundException();
    const offers = await this.db.query(`SELECT f.id,f.price_per_kg::float AS "pricePerKg",f.products,f.fulfillment,
      f.scheduled_date::text AS "scheduledDate",f.scheduled_session AS "scheduledSession",f.fee_per_kg::float AS "feePerKg",
      f.message,f.status,f.created_at AS "createdAt",
      json_build_object('id',o.id,'name',o.name,'logoUrl',o.logo_url,'provinceName',p.name,'verified',EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified')) AS dealer
      FROM agrilink_intent_offers f JOIN agrilink_organizations o ON o.id=f.organization_id
      LEFT JOIN admin_provinces p ON p.code=o.province_code WHERE f.intent_id=$1 ORDER BY f.created_at DESC`, [id]);
    return { intent: this.publicIntent(r), matches: await this.matches(r), offers: offers.map((o: any) => ({...o, effectivePrice: r.side === 'sell' && o.pricePerKg != null ? o.pricePerKg - o.feePerKg : null})) };
  }
  async close(v: CommunityViewer, id: string, reason?: string) {
    const [r] = await this.db.query(
      `UPDATE agrilink_intents SET status='closed',note=CASE WHEN $3::text IS NULL THEN note ELSE left($3,500) END,updated_at=now()
      WHERE id=$1 AND requester_id=$2 AND status='open' RETURNING id,status`,
      [id, v.id, reason ?? null],
    );
    if (!r) throw new NotFoundException();
    return r;
  }
  async leads(v: CommunityViewer, q: LeadsQuery) {
    if (
      !['owner', 'manager'].includes(v.role) ||
      !v.organizationId ||
      !v.memberships.some((m) => m.id === v.organizationId)
    )
      throw new ForbiddenException(
        'Chỉ chủ hoặc quản lý đại lý được xem nguồn hàng.',
      );
    const rows = await this.db.query(
      `SELECT id FROM agrilink_intents WHERE status='open' AND window_end >= $1::date AND requester_id<>$2 AND ($3::text IS NULL OR side=$3) AND ($4::uuid IS NULL OR crop_id=$4) ORDER BY created_at DESC LIMIT 500`,
      [vnDate(), v.id, q.side ?? null, q.cropId ?? null],
    );
    const result: any[] = [];
    for (const x of rows) {
      const r = await this.row(x.id);
      const mine = (await this.matches(r, Infinity)).find(
        (m) => m.dealer.id === v.organizationId,
      );
      if (mine)
        result.push({
          intentId: r.id,
          side: r.side,
          crop: r.cropId ? { id: r.cropId, name: r.cropName } : null,
          productQuery: r.productQuery,
          quantityKg: r.quantityKg,
          quantityText: r.quantityText,
          provinceName: r.provinceName,
          communeName: r.communeName,
          distanceKm: mine.distanceKm,
          windowStart: dateString(r.windowStart),
          windowEnd: dateString(r.windowEnd),
          expectedPricePerKg: r.expectedPricePerKg,
          fulfillmentPref: r.fulfillmentPref,
          createdAt: r.createdAt,
          myScore: mine.score,
        });
      if (result.length >= 50) break;
    }
    return result;
  }
  @Cron('0 * * * *')
  async expire() {
    await this.db.query(
      `UPDATE agrilink_intents SET status='expired',updated_at=now() WHERE status='open' AND window_end < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
    );
  }
}
