import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DataSource, EntityManager } from 'typeorm';
import { lockSlot, serviceSlots, Session } from '../agrilink-intents/booking';
import {
  CommunityService,
  CommunityViewer,
} from '../community/community.service';
import { notifyDealerStaff } from '../agrilink-orders/agrilink-notify';
import { postOrderCard, postOrderStatusLine } from '../agrilink-messaging/order-thread';
import { nextAgrilinkCode } from '../agrilink-orders/order-code';
import { nextStatus } from '../agrilink-orders/order-state';
import { validateLocation } from '../agri-reference/location';
import { AgriReferenceService } from '../agri-reference/agri-reference.service';
import { AgrilinkTrustService } from './agrilink-trust.service';
import { BUY_OFFER_STALE_HOURS, priceAgeHours, priceFreshness, stalePrice } from './trust-pricing';
import { RatingDto, VerificationDto } from './agrilink-trust.dto';
import { DealerServiceDto } from './dealer-services.dto';
import { saleOfferSql } from './sale-offer-sql';
import { validateListing } from './listing-rules';
import { linkVoucherClaim, releaseVoucher, reserveVoucher } from './voucher-order';
import { managerOrganization, ownOrganization } from './manage-access';
import {
  BuyOfferDto,
  ManageProductsQuery,
  PlaceOrderDto,
  ProductListingDto,
  ProfileDto,
  UpdateBuyOfferDto,
} from './marketplace.dto';

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly db: DataSource,
    private readonly community: CommunityService,
    @Optional() private readonly trust?: AgrilinkTrustService,
    @Optional() private readonly reference?: AgriReferenceService,
  ) {}

  viewer(id: string) {
    return this.community.viewer(id);
  }

  private ownOrganization(v: CommunityViewer): string {
    return ownOrganization(v);
  }

  private managerOrganization(v: CommunityViewer): string {
    return managerOrganization(v);
  }

  async dealers(q = '', crop = '', province = '') {
    // Tin thu mua "còn mới": đang mở và giá được cập nhật trong BUY_OFFER_STALE_HOURS giờ.
    const freshBuy = (a: string) =>
      `${a}.kind='buy' AND ${a}.active AND ${a}.price_updated_at > now()-make_interval(hours => $2)`;
    const cropOf = '(c.id=bf.crop_id OR (bf.crop_id IS NULL AND c.commodity_type=bf.commodity_type))';
    const rows = await this.db.query(
      `SELECT o.id,o.name,o.bio,o.region,o.address,o.phone,o.logo_url AS "logoUrl",o.cover_url AS "coverUrl",
       o.opening_hours AS "openingHours",o.fulfillment_options AS "fulfillmentOptions",
       p.name AS "provinceName",
       (SELECT COALESCE(json_agg(json_build_object('kind',s.kind,'feeMode',s.fee_mode,
         'feeAmount',s.fee_amount::float,'areaMode',s.area_mode,'radiusKm',s.radius_km)
         ORDER BY s.kind),'[]'::json) FROM agrilink_dealer_services s
         WHERE s.organization_id=o.id AND s.active) AS services,
       count(f.id) FILTER (WHERE f.kind='sale' AND f.active AND pr."isActive")::int AS "saleCount",
       count(f.id) FILTER (WHERE f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $2) AND (f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL))::int AS "buyCount",
       EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified') AS verified,
       (SELECT COALESCE(json_agg(json_build_object('code',t.code,'name',t.name) ORDER BY t.name),'[]'::json)
         FROM (SELECT DISTINCT c.code,c.name FROM agrilink_offers bf JOIN agri_crops c ON ${cropOf}
           WHERE bf.organization_id=o.id AND ${freshBuy('bf')}) t) AS crops
       FROM agrilink_organizations o
       LEFT JOIN admin_provinces p ON p.code=o.province_code
       LEFT JOIN agrilink_offers f ON f.organization_id=o.id
       LEFT JOIN products pr ON pr.id=f.product_id AND pr."organizationId"=o.id
       WHERE o.marketplace_enabled
         AND ($1='' OR unaccent(concat_ws(' ',o.name,o.region,o.address,p.name)) ILIKE unaccent('%'||$1||'%'))
         AND ($4='' OR o.province_code=$4)
         AND ($3='' OR EXISTS(SELECT 1 FROM agrilink_offers bf JOIN agri_crops c ON ${cropOf}
           WHERE bf.organization_id=o.id AND ${freshBuy('bf')} AND c.code=$3))
       GROUP BY o.id,p.name ORDER BY o.name LIMIT 100`,
      [q.trim().slice(0, 100), BUY_OFFER_STALE_HOURS, crop.trim().slice(0, 60), province.trim().slice(0, 60)],
    );
    const ratings = await this.trust?.aggregatesFor(rows.map((r: any) => r.id)) ?? new Map();
    return rows.map((r: any) => ({ ...r, ratings: ratings.get(r.id) }));
  }

  availability(id: string, kind: string, from: string, to: string) {
    return serviceSlots((sql, params) => this.db.query(sql, params), id, kind, from, to);
  }

  async dealer(id: string) {
    const [dealer] = await this.db.query(
      `SELECT o.id,o.name,o.bio,o.region,o.address,o.phone,o.logo_url AS "logoUrl",o.cover_url AS "coverUrl",
       o.opening_hours AS "openingHours",o.fulfillment_options AS "fulfillmentOptions",
       p.name AS "provinceName",o.province_code AS "provinceCode",
       EXISTS(SELECT 1 FROM agrilink_dealer_verifications d WHERE d.organization_id=o.id AND d.status='verified') AS verified,
       (SELECT COALESCE(json_agg(json_build_object('kind',s.kind,'feeMode',s.fee_mode,
         'feeAmount',s.fee_amount::float,'areaMode',s.area_mode,'radiusKm',s.radius_km)
         ORDER BY s.kind),'[]'::json) FROM agrilink_dealer_services s
         WHERE s.organization_id=o.id AND s.active) AS services
       FROM agrilink_organizations o LEFT JOIN admin_provinces p ON p.code=o.province_code
       WHERE o.id=$1 AND o.marketplace_enabled`,
      [id],
    );
    if (!dealer) throw new NotFoundException('Không tìm thấy đại lý.');
    const s = saleOfferSql('f', 'p');
    const saleRows: any[] = await this.db.query(
      `SELECT f.id AS "offerId",p.id AS "productId",${s.name} AS name,${s.unit} AS unit,
       ${s.price}::float AS price,
       CASE WHEN ${s.promo} THEN (${s.base})::float END AS "originalPrice",
       CASE WHEN ${s.promo} THEN f.sale_ends_at END AS "saleEndsAt",
       f.description,f.images,p."imageUrl" AS "productImageUrl",
       (p."stockQuantity" > 0) AS "inStock"
       FROM agrilink_offers f JOIN products p ON p.id=f.product_id AND p."organizationId"=f.organization_id
       WHERE f.organization_id=$1 AND f.kind='sale' AND f.active AND p."isActive"
       ORDER BY ${s.name}`,
      [id],
    );
    const saleOffers = saleRows.map(({ productImageUrl, originalPrice, saleEndsAt, images, ...offer }) => {
      const gallery: string[] = Array.isArray(images) && images.length ? images : productImageUrl ? [productImageUrl] : [];
      return {
        ...offer,
        images: gallery,
        imageUrl: gallery[0] ?? null,
        ...(originalPrice != null ? { originalPrice, saleEndsAt } : {}),
      };
    });
    const buyOffers = await this.db.query(
      `SELECT f.id AS "offerId",f.title,f.crop_id AS "cropId",c.code AS "cropCode",c.name AS "cropName",f.commodity_type AS "commodityType",f.unit,
       f.price::float AS price,f.max_quantity_kg::float AS "maxQuantityKg",f.valid_until AS "validUntil",f.updated_at AS "updatedAt",f.price_updated_at AS "priceUpdatedAt"
       FROM agrilink_offers f LEFT JOIN agri_crops c ON c.id=f.crop_id
         WHERE f.organization_id=$1 AND f.kind='buy' AND f.active AND f.price_updated_at > now()-make_interval(hours => $2) AND (f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL)
       ORDER BY f.updated_at DESC`,
      [id, BUY_OFFER_STALE_HOURS],
    );
    const ratings = await this.trust?.aggregates(id) ?? null;
    return { dealer: { ...dealer, ratings }, saleOffers, buyOffers: await Promise.all(buyOffers.map(async (o: any) => ({ ...o, priceFreshness: priceFreshness(o.priceUpdatedAt), market: o.cropId ? await this.reference?.marketPrice(o.cropId, dealer.provinceCode) ?? null : null }))) };
  }

  async profile(v: CommunityViewer) {
    const id = this.managerOrganization(v);
    const [p] = await this.db.query(
      `SELECT name,bio,region,address,phone,logo_url AS "logoUrl",cover_url AS "coverUrl",opening_hours AS "openingHours",
         fulfillment_options AS "fulfillmentOptions",marketplace_enabled AS "marketplaceEnabled",
         province_code AS "provinceCode",commune_code AS "communeCode",lat::float AS lat,lng::float AS lng
       FROM agrilink_organizations WHERE id=$1`,
      [id],
    );
    return p;
  }

  async updateProfile(v: CommunityViewer, dto: ProfileDto) {
    const id = this.managerOrganization(v);
    const changingLocation = dto.provinceCode !== undefined || dto.communeCode !== undefined;
    const changingCoords = dto.lat !== undefined || dto.lng !== undefined;
    if ((dto.lat === undefined) !== (dto.lng === undefined))
      throw new BadRequestException('Vĩ độ và kinh độ phải được cập nhật cùng nhau.');
    let location: { provinceCode: string | null; communeCode: string | null } | null = null;
    if (changingLocation || changingCoords) {
      const [current] = await this.db.query(
        'SELECT province_code,commune_code,lat,lng FROM agrilink_organizations WHERE id=$1', [id],
      );
      location = await validateLocation(this.db, {
        provinceCode: current?.province_code ?? null,
        communeCode: current?.commune_code ?? null,
      }, dto);
      if (changingCoords && dto.lat !== null && dto.lng !== null &&
        (dto.lat! < 8 || dto.lat! > 24 || dto.lng! < 102 || dto.lng! > 110))
        throw new BadRequestException('Tọa độ phải nằm trong Việt Nam.');
      if (changingCoords && (dto.lat === null) !== (dto.lng === null))
        throw new BadRequestException('Vĩ độ và kinh độ phải cùng có giá trị hoặc cùng trống.');
    }
    await this.db.query(
      `UPDATE agrilink_organizations SET
         name=COALESCE($2,name), bio=COALESCE($3,bio), region=COALESCE($4,region), address=COALESCE($5,address),
         phone=COALESCE($6,phone), opening_hours=COALESCE($7,opening_hours),
         fulfillment_options=COALESCE($8,fulfillment_options), marketplace_enabled=COALESCE($9,marketplace_enabled),
         province_code=CASE WHEN $10::boolean THEN $11 ELSE province_code END,
         commune_code=CASE WHEN $10::boolean THEN $12 ELSE commune_code END,
         lat=CASE WHEN $13::boolean THEN $14 ELSE lat END,
         lng=CASE WHEN $13::boolean THEN $15 ELSE lng END
       WHERE id=$1`,
      [
        id,
        dto.name?.trim() ?? null,
        dto.bio?.trim() ?? null,
        dto.region?.trim() ?? null,
        dto.address?.trim() ?? null,
        dto.phone?.trim() ?? null,
        dto.openingHours?.trim() ?? null,
        dto.fulfillmentOptions ?? null,
        dto.marketplaceEnabled ?? null,
        changingLocation,
        location?.provinceCode ?? null,
        location?.communeCode ?? null,
        changingCoords,
        dto.lat ?? null,
        dto.lng ?? null,
      ],
    );
    return this.profile(v);
  }

  async services(v: CommunityViewer) {
    const id = this.managerOrganization(v);
    const rows = await this.db.query(
      `SELECT s.kind,s.active,s.crop_ids AS "cropIds",s.area_mode AS "areaMode",
         s.radius_km AS "radiusKm",s.province_codes AS "provinceCodes",
         s.fee_mode AS "feeMode",s.fee_amount::float AS "feeAmount",
         s.min_quantity_kg::float AS "minQuantityKg",s.lead_time_hours AS "leadTimeHours",s.note,
         COALESCE((SELECT json_agg(json_build_object('weekday',w.weekday,'session',w.session,
           'capacity',w.capacity) ORDER BY w.weekday,w.session)
           FROM agrilink_service_windows w WHERE w.service_id=s.id),'[]'::json) AS windows
       FROM agrilink_dealer_services s WHERE s.organization_id=$1`,
      [id],
    );
    return ['farm_pickup', 'supply_delivery'].map((kind) => rows.find((row: any) => row.kind === kind) ?? null);
  }

  async putService(v: CommunityViewer, kind: string, dto: DealerServiceDto) {
    const id = this.managerOrganization(v);
    if (kind !== 'farm_pickup' && kind !== 'supply_delivery')
      throw new BadRequestException('Loại dịch vụ không hợp lệ.');
    if (dto.areaMode === 'radius' && dto.radiusKm == null)
      throw new BadRequestException('Cần bán kính phục vụ.');
    if (dto.areaMode === 'provinces' && !dto.provinceCodes.length)
      throw new BadRequestException('Cần ít nhất một tỉnh/thành phục vụ.');
    if (dto.feeMode === 'free' && dto.feeAmount !== 0)
      throw new BadRequestException('Dịch vụ miễn phí phải có phí bằng 0.');
    if (kind === 'supply_delivery' && dto.cropIds.length)
      throw new BadRequestException('Dịch vụ giao vật tư không chọn cây trồng.');
    const windows = new Set(dto.windows.map((w) => `${w.weekday}:${w.session}`));
    if (windows.size !== dto.windows.length)
      throw new BadRequestException('Trùng buổi phục vụ.');
    if (dto.areaMode === 'radius') {
      const [coords] = await this.db.query(
        'SELECT lat,lng FROM agrilink_effective_coords WHERE organization_id=$1', [id],
      );
      if (coords?.lat == null || coords?.lng == null)
        throw new BadRequestException('Cần vị trí đại lý để dùng bán kính phục vụ.');
    } else {
      const provinces = await this.db.query('SELECT code FROM admin_provinces WHERE code=ANY($1::text[])', [dto.provinceCodes]);
      if (provinces.length !== dto.provinceCodes.length)
        throw new BadRequestException('Tỉnh/thành phục vụ không hợp lệ.');
    }
    if (kind === 'farm_pickup' && dto.cropIds.length) {
      const crops = await this.db.query('SELECT id FROM agri_crops WHERE id=ANY($1::uuid[])', [dto.cropIds]);
      if (crops.length !== dto.cropIds.length)
        throw new BadRequestException('Cây trồng phục vụ không hợp lệ.');
    }
    await this.db.transaction(async (em) => {
      const [row] = await em.query(
        `INSERT INTO agrilink_dealer_services(organization_id,kind,active,crop_ids,area_mode,
           radius_km,province_codes,fee_mode,fee_amount,min_quantity_kg,lead_time_hours,note)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT(organization_id,kind) DO UPDATE SET active=excluded.active,
           crop_ids=excluded.crop_ids,area_mode=excluded.area_mode,radius_km=excluded.radius_km,
           province_codes=excluded.province_codes,fee_mode=excluded.fee_mode,
           fee_amount=excluded.fee_amount,min_quantity_kg=excluded.min_quantity_kg,
           lead_time_hours=excluded.lead_time_hours,note=excluded.note,updated_at=now()
         RETURNING id`,
        [id,kind,dto.active,dto.cropIds,dto.areaMode,dto.areaMode === 'radius' ? dto.radiusKm : null,
          dto.areaMode === 'provinces' ? dto.provinceCodes : [],dto.feeMode,dto.feeAmount,
          dto.minQuantityKg,dto.leadTimeHours,dto.note.trim()],
      );
      await em.query('DELETE FROM agrilink_service_windows WHERE service_id=$1', [row.id]);
      for (const window of dto.windows)
        await em.query(
          'INSERT INTO agrilink_service_windows(service_id,weekday,session,capacity) VALUES($1,$2,$3,$4)',
          [row.id,window.weekday,window.session,window.capacity],
        );
    });
    return (await this.services(v))[kind === 'farm_pickup' ? 0 : 1];
  }

  async uploadLogo(v: CommunityViewer, file?: Express.Multer.File) {
    const id = this.managerOrganization(v);
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh logo.');
    const dir = join(process.cwd(), 'uploads', 'logos');
    await mkdir(dir, { recursive: true });
    const name = `${id}-${Date.now()}.webp`;
    try {
      await sharp(file.buffer)
        .rotate()
        .resize(512, 512, { fit: 'inside' })
        .webp({ quality: 85 })
        .toFile(join(dir, name));
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ.');
    }
    const logoUrl = `/uploads/logos/${name}`;
    await this.db.query(
      'UPDATE agrilink_organizations SET logo_url=$2 WHERE id=$1',
      [id, logoUrl],
    );
    return { logoUrl };
  }

  async uploadCover(v: CommunityViewer, file?: Express.Multer.File) {
    const id = this.managerOrganization(v);
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh bìa.');
    const dir = join(process.cwd(), 'uploads', 'covers');
    await mkdir(dir, { recursive: true });
    const name = `${id}-${Date.now()}.webp`;
    try {
      await sharp(file.buffer)
        .rotate()
        .resize(1600, 600, { fit: 'cover', position: 'attention' })
        .webp({ quality: 80 })
        .toFile(join(dir, name));
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ.');
    }
    const coverUrl = `/uploads/covers/${name}`;
    await this.db.query(
      'UPDATE agrilink_organizations SET cover_url=$2 WHERE id=$1',
      [id, coverUrl],
    );
    return { coverUrl };
  }

  /** Ảnh cho tin bán vật tư; chỉ gắn vào tin khi đại lý lưu danh sách ảnh. */
  async uploadListingImage(v: CommunityViewer, productId: string, file?: Express.Multer.File) {
    const id = this.managerOrganization(v);
    if (!file) throw new BadRequestException('Vui lòng chọn ảnh.');
    const [product] = await this.db.query(
      'SELECT id FROM products WHERE id=$1 AND "organizationId"=$2',
      [productId, id],
    );
    if (!product) throw new NotFoundException('Sản phẩm không thuộc đại lý.');
    const dir = join(process.cwd(), 'uploads', 'listings');
    await mkdir(dir, { recursive: true });
    const name = `${id}-${productId}-${Date.now()}.webp`;
    try {
      await sharp(file.buffer)
        .rotate()
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(join(dir, name));
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ.');
    }
    return { url: `/uploads/listings/${name}` };
  }

  /** Cột trả về cho một sản phẩm trong trang "Sản phẩm đăng bán". */
  private managedProductColumns() {
    const s = saleOfferSql('f', 'p');
    return `p.id AS "productId",p.name,p.unit,p."sellingPrice"::float AS "sellingPrice",p."imageUrl",
         p."stockQuantity"::float AS "stockQuantity",(p."stockQuantity">0) AS "inStock",
         COALESCE(f.active,false) AS published, f.price::float AS "agrilinkPrice",
         COALESCE(f.title,'') AS title, COALESCE(f.unit,'') AS "listingUnit", COALESCE(f.description,'') AS description,
         COALESCE(f.images,'[]'::jsonb) AS images, f.sale_price::float AS "salePrice", f.sale_ends_at AS "saleEndsAt",
         COALESCE(${s.promo},false) AS "saleActive", (${s.price})::float AS "effectivePrice"`;
  }

  private async productRow(orgId: string, productId: string) {
    const [row] = await this.db.query(
      `SELECT ${this.managedProductColumns()}
       FROM products p LEFT JOIN agrilink_offers f ON f.product_id=p.id AND f.organization_id=$1 AND f.kind='sale'
       WHERE p."organizationId"=$1 AND p.id=$2`,
      [orgId, productId],
    );
    return row;
  }

  async listProducts(v: CommunityViewer, q: ManageProductsQuery) {
    const id = this.managerOrganization(v);
    const limit = q.limit ?? 50,
      offset = ((q.page ?? 1) - 1) * limit;
    const where = `p."organizationId"=$1 AND p."isActive" AND ($2='' OR p.name ILIKE '%'||$2||'%')
                   AND ($3::boolean IS NULL OR COALESCE(f.active,false)=$3)`;
    const params = [
      id,
      (q.q ?? '').trim(),
      q.published == null ? null : q.published === 'true',
    ];
    const join_ = `FROM products p LEFT JOIN agrilink_offers f ON f.product_id=p.id AND f.organization_id=$1 AND f.kind='sale'`;
    const items = await this.db.query(
      `SELECT ${this.managedProductColumns()}
       ${join_} WHERE ${where} ORDER BY p.name LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const [{ total }] = await this.db.query(
      `SELECT count(*)::int AS total ${join_} WHERE ${where}`,
      params,
    );
    return { items, total };
  }

  async setProduct(
    v: CommunityViewer,
    productId: string,
    dto: ProductListingDto,
  ) {
    const id = this.managerOrganization(v);
    // Một giao dịch + khoá dòng tin bán: kiểm tra giá KM và lưu luôn thấy cùng một giá bán.
    await this.db.transaction(async (em) => {
      const [product] = await em.query(
        'SELECT id,"sellingPrice"::float AS "sellingPrice" FROM products WHERE id=$1 AND "organizationId"=$2',
        [productId, id],
      );
      if (!product) throw new NotFoundException('Sản phẩm không thuộc đại lý.');
      await em.query(
        `INSERT INTO agrilink_offers(organization_id,kind,product_id,active,price) VALUES($1,'sale',$2,$3,$4)
         ON CONFLICT(organization_id,product_id) WHERE kind='sale' DO NOTHING`,
        [id, productId, dto.published, dto.price ?? null],
      );
      const [offer] = await em.query(
        `SELECT price::float AS "currentPrice" FROM agrilink_offers
         WHERE organization_id=$1 AND product_id=$2 AND kind='sale' FOR UPDATE`,
        [id, productId],
      );
      const onlinePrice = dto.price !== undefined ? dto.price : offer?.currentPrice;
      validateListing(dto, Number(onlinePrice ?? product.sellingPrice), id);

      // Chỉ cập nhật các trường được gửi lên; trường không gửi giữ nguyên.
      const params: unknown[] = [id, productId, dto.published];
      const sets = ['active=$3'];
      const set = (column: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${column}=$${params.length}${cast}`);
      };
      if (dto.price !== undefined) set('price', dto.price);
      if (dto.title !== undefined) set('title', dto.title.trim());
      if (dto.unit !== undefined) set('unit', dto.unit.trim());
      if (dto.description !== undefined) set('description', dto.description.trim());
      if (dto.images !== undefined) set('images', JSON.stringify(dto.images), '::jsonb');
      if (dto.salePrice !== undefined) {
        set('sale_price', dto.salePrice);
        set('sale_ends_at', dto.salePrice === null ? null : dto.saleEndsAt);
      }
      await em.query(
        `UPDATE agrilink_offers SET ${sets.join(',')},updated_at=now()
         WHERE organization_id=$1 AND product_id=$2 AND kind='sale'`,
        params,
      );
    });
    return this.productRow(id, productId);
  }

  async buyOffers(v: CommunityViewer) {
    const id = this.managerOrganization(v);
    const [org] = await this.db.query('SELECT province_code AS "provinceCode" FROM agrilink_organizations WHERE id=$1', [id]);
    const rows = await this.db.query(
       `SELECT id,title,crop_id AS "cropId",commodity_type AS "commodityType",(commodity_type IS NOT NULL OR crop_id IS NOT NULL) AS "orderable",unit,price::float AS price,active,max_quantity_kg::float AS "maxQuantityKg",valid_until AS "validUntil",updated_at AS "updatedAt",price_updated_at AS "priceUpdatedAt"
       FROM agrilink_offers WHERE organization_id=$1 AND kind='buy' ORDER BY active DESC, updated_at DESC`,
      [id],
    );
    return Promise.all(rows.map(async (r: any) => this.decorateManagedOffer(r, org?.provinceCode)));
  }

  private async decorateManagedOffer(r: any, province?: string) {
    return { ...r, stale: stalePrice(r.priceUpdatedAt), priceAgeHours: priceAgeHours(r.priceUpdatedAt), market: r.cropId ? await this.reference?.marketPrice(r.cropId, province) ?? null : null };
  }

  async addBuyOffer(v: CommunityViewer, dto: BuyOfferDto) {
    const id = this.managerOrganization(v);
    const commodityType = dto.cropId
      ? await this.commodityForCrop(dto.cropId)
      : (dto.commodityType ?? null);
    const [offer] = await this.db.query(
      `INSERT INTO agrilink_offers(organization_id,kind,title,commodity_type,unit,price,crop_id,max_quantity_kg,valid_until,price_updated_at) VALUES($1,'buy',$2,$3,$4,$5,$6,$7,$8,now())
       RETURNING id,title,crop_id AS "cropId",commodity_type AS "commodityType",unit,price::float AS price,active,max_quantity_kg::float AS "maxQuantityKg",valid_until AS "validUntil",updated_at AS "updatedAt",price_updated_at AS "priceUpdatedAt"`,
      [id, dto.title.trim(), commodityType, dto.unit.trim(), dto.price, dto.cropId ?? null,dto.maxQuantityKg ?? null,dto.validUntil ?? null],
    );
    const [org] = await this.db.query('SELECT province_code AS "provinceCode" FROM agrilink_organizations WHERE id=$1', [id]);
    return this.decorateManagedOffer(offer, org?.provinceCode);
  }

  async updateBuyOffer(
    v: CommunityViewer,
    offerId: string,
    dto: UpdateBuyOfferDto,
  ) {
    const id = this.managerOrganization(v);
    const changingCrop = dto.cropId !== undefined || dto.commodityType !== undefined;
    const commodityType = dto.cropId
      ? await this.commodityForCrop(dto.cropId)
      : (dto.commodityType ?? null);
    const [offer] = await this.db.query(
      `UPDATE agrilink_offers SET title=COALESCE($3,title),price=COALESCE($4,price),active=COALESCE($5,active),
         crop_id=CASE WHEN $6::boolean THEN $7 ELSE crop_id END,
         commodity_type=CASE WHEN $6::boolean THEN $8 ELSE commodity_type END,
         max_quantity_kg=CASE WHEN $9::boolean THEN $10 ELSE max_quantity_kg END,
         valid_until=CASE WHEN $11::boolean THEN $12 ELSE valid_until END,updated_at=now(),
         price_updated_at=CASE WHEN $4::numeric IS NOT NULL AND price IS DISTINCT FROM $4 THEN now() ELSE price_updated_at END
       WHERE id=$1 AND organization_id=$2 AND kind='buy'
       RETURNING id,title,crop_id AS "cropId",commodity_type AS "commodityType",unit,price::float AS price,active,max_quantity_kg::float AS "maxQuantityKg",valid_until AS "validUntil",updated_at AS "updatedAt",price_updated_at AS "priceUpdatedAt"`,
      [
        offerId,
        id,
        dto.title?.trim() ?? null,
        dto.price ?? null,
        dto.active ?? null,
        changingCrop,
        dto.cropId ?? null,
        commodityType,
        dto.maxQuantityKg !== undefined,
        dto.maxQuantityKg ?? null,
        dto.validUntil !== undefined,
        dto.validUntil ?? null,
      ],
    );
    if (!offer) throw new NotFoundException();
    const [org] = await this.db.query('SELECT province_code AS "provinceCode" FROM agrilink_organizations WHERE id=$1', [id]);
    return this.decorateManagedOffer(offer, org?.provinceCode);
  }

  private async commodityForCrop(cropId: string): Promise<string | null> {
    const [crop] = await this.db.query('SELECT commodity_type FROM agri_crops WHERE id=$1', [cropId]);
    if (!crop) throw new BadRequestException('Cây trồng không hợp lệ.');
    return crop.commodity_type;
  }

  async removeBuyOffer(v: CommunityViewer, offerId: string) {
    const r = await this.updateBuyOffer(v, offerId, { active: false });
    return { id: r.id };
  }

  async confirmBuyOffer(v: CommunityViewer, offerId: string) {
    const id = this.managerOrganization(v);
    const [offer] = await this.db.query(`UPDATE agrilink_offers SET price_updated_at=now(),updated_at=now() WHERE id=$1 AND organization_id=$2 AND kind='buy' RETURNING id,title,crop_id AS "cropId",commodity_type AS "commodityType",unit,price::float AS price,active,max_quantity_kg::float AS "maxQuantityKg",valid_until AS "validUntil",updated_at AS "updatedAt",price_updated_at AS "priceUpdatedAt"`, [offerId,id]);
    if (!offer) throw new NotFoundException();
    const [org] = await this.db.query('SELECT province_code AS "provinceCode" FROM agrilink_organizations WHERE id=$1', [id]);
    return this.decorateManagedOffer(offer, org?.provinceCode);
  }

  async confirmAllBuyOffers(v: CommunityViewer) {
    const id = this.managerOrganization(v);
    const rows = await this.db.query(`UPDATE agrilink_offers SET price_updated_at=now(),updated_at=now() WHERE organization_id=$1 AND kind='buy' AND active RETURNING id`, [id]);
    return { count: rows.length };
  }

  ratings(id: string, page = 1) { return this.trust!.publicRatings(id,page); }
  manageRatings(v: CommunityViewer, page = 1) { return this.trust!.manageRatings(v,page); }
  rate(v: CommunityViewer, orderId: string, dto: RatingDto) { return this.trust!.rate(v,orderId,dto); }
  verification(v: CommunityViewer) { return this.trust!.verification(v); }
  submitVerification(v: CommunityViewer, dto: VerificationDto) { return this.trust!.submit(v,dto); }

  async placeOrder(v: CommunityViewer, dealerId: string, dto: PlaceOrderDto) {
    const id = await this.db.transaction((em) => this.placeOrderTx(em, v, dealerId, dto));
    return this.myOrder(v, id);
  }

  async placeOrderTx(em: EntityManager, v: CommunityViewer, dealerId: string, dto: PlaceOrderDto,
    extras: { intentId?: string; scheduledDate?: string; scheduledSession?: string; pricesOverride?: Map<string, number>; cropId?: string } = {}): Promise<string> {
    if (v.suspended)
      throw new ForbiddenException('Tài khoản đang bị tạm khóa.');
    if (v.memberships.some((m) => m.id === dealerId))
      throw new BadRequestException(
        'Không thể tự đặt đơn với đại lý của mình.',
      );
    const ids = dto.items.map((i) => i.offerId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(
        'Mỗi mặt hàng chỉ xuất hiện một lần trong đơn.',
      );
    if (dto.kind === 'sell' && dto.items.length !== 1)
      throw new BadRequestException(
        'Đơn bán nông sản chỉ gồm một loại nông sản.',
      );
    if (dto.kind === 'sell' && dto.fulfillment !== 'at_dealer' && !(dto.fulfillment === 'delivery' && extras.scheduledDate && extras.scheduledSession))
      throw new BadRequestException('Đơn bán nông sản cần giao tại đại lý.');
    if (dto.fulfillment === 'delivery' && dto.kind === 'buy' && !dto.address?.trim())
      throw new BadRequestException('Cần địa chỉ giao hàng.');
    if (dto.voucherId && (dto.kind !== 'buy' || extras.intentId))
      throw new BadRequestException('Voucher chỉ dùng cho đơn mua vật tư đặt từ giỏ hàng.');

    const q = (sql: string, p: unknown[]) => em.query(sql, p);
    const sale = saleOfferSql('f', 'p');
        const [dealer] = await q(
          'SELECT id,fulfillment_options FROM agrilink_organizations WHERE id=$1 AND marketplace_enabled',
          [dealerId],
        );
        if (!dealer) throw new NotFoundException('Không tìm thấy đại lý.');
        if (
          dto.kind === 'buy' &&
           !dealer.fulfillment_options.includes(dto.fulfillment) &&
           !(dto.fulfillment === 'delivery' && extras.scheduledDate && extras.scheduledSession)
        )
          throw new BadRequestException(
            'Đại lý không hỗ trợ hình thức nhận hàng này.',
          );

        const offers: any[] = await q(
          `SELECT f.id,f.kind,f.product_id,f.commodity_type,f.crop_id,
           CASE WHEN f.kind='sale' THEN ${sale.name} ELSE f.title END AS name,
           CASE WHEN f.kind='sale' THEN ${sale.unit} ELSE f.unit END AS unit,
           CASE WHEN f.kind='sale' THEN ${sale.price} ELSE f.price END AS price,
           (f.kind='buy' AND f.price_updated_at <= now()-make_interval(hours => $3)) AS stale
         FROM agrilink_offers f
         LEFT JOIN products p ON p.id=f.product_id AND p."organizationId"=f.organization_id AND p."isActive"
         WHERE f.id = ANY($1::uuid[]) AND f.organization_id=$2 AND f.active
           AND (f.kind='buy' OR p.id IS NOT NULL)
            AND (f.kind='sale' OR f.commodity_type IS NOT NULL OR f.crop_id IS NOT NULL)`,
          [ids, dealerId, BUY_OFFER_STALE_HOURS],
        );
        const wanted = dto.kind === 'buy' ? 'sale' : 'buy';
        const byId = new Map(
          offers.filter((o) => o.kind === wanted).map((o) => [o.id, o]),
        );
        if (dto.kind === 'sell' && ids.some(id => byId.get(id)?.stale))
          throw new BadRequestException('Giá thu mua đã cũ, đại lý cần cập nhật giá.');
        if (ids.some((id) => !byId.has(id)))
          throw new BadRequestException(
            'Có mặt hàng không còn khả dụng. Vui lòng tải lại gian hàng.',
          );

        const lines = dto.items.map((i) => {
          const o = byId.get(i.offerId)!;
          return {
            ...i,
            offer: o,
            price: extras.pricesOverride?.get(i.offerId) ?? Number(o.price),
            total: Math.round(i.quantity * (extras.pricesOverride?.get(i.offerId) ?? Number(o.price))),
          };
        });
        const estimatedTotal = lines.reduce((s, l) => s + l.total, 0);
        if (estimatedTotal > 9_999_999_999_999)
          throw new BadRequestException('Tổng tiền vượt giới hạn.');
        const voucher = dto.voucherId
          ? await reserveVoucher(q, { voucherId: dto.voucherId, dealerId, userId: v.id, subtotal: estimatedTotal, now: new Date() })
          : null;

         const serviceKind = dto.fulfillment === 'delivery'
           ? dto.kind === 'sell' ? 'farm_pickup' : 'supply_delivery'
           : null;
         const serviceId = serviceKind && extras.scheduledDate && extras.scheduledSession
           ? await lockSlot(em, dealerId, serviceKind, extras.scheduledDate, extras.scheduledSession as Session)
           : undefined;
         let orderId = '';
        for (let attempt = 1; attempt <= 3; attempt++) {
          await q('SAVEPOINT al_code', []);
          try {
            const code = await nextAgrilinkCode(q, dealerId);
            const [row] = await q(
              `INSERT INTO agrilink_orders("organizationId",code,"requesterId",kind,fulfillment,address,note,"contactName","contactPhone","estimatedTotal","intentId","scheduledDate","scheduledSession","voucherId","voucherSnapshot","discountAmount")
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16) RETURNING id`,
              [
                dealerId,
                code,
                v.id,
                dto.kind,
                dto.fulfillment,
                dto.address?.trim() || '',
                dto.note?.trim() || '',
                dto.contactName.trim(),
                dto.contactPhone.trim(),
                estimatedTotal,
                extras.intentId ?? null,
                extras.scheduledDate ?? null,
                extras.scheduledSession ?? null,
                voucher?.voucherId ?? null,
                voucher ? JSON.stringify(voucher.snapshot) : null,
                voucher?.discount ?? 0,
              ],
            );
            orderId = row.id;
            await q('RELEASE SAVEPOINT al_code', []);
            break;
          } catch (e: any) {
            await q('ROLLBACK TO SAVEPOINT al_code', []);
            if (e?.code === '23505' && attempt < 3) continue;
            throw e;
          }
        }
        for (const l of lines)
          await q(
            `INSERT INTO agrilink_order_items("organizationId","orderId","offerId","productId","commodityType","cropId","itemName",unit,quantity,"unitPrice")
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              dealerId,
              orderId,
              l.offer.id,
              l.offer.product_id,
              l.offer.commodity_type,
              l.offer.crop_id ?? extras.cropId ?? null,
              l.offer.name,
              l.offer.unit,
              l.quantity,
              l.price,
            ],
          );
        await q(
          `INSERT INTO agrilink_order_events("organizationId","orderId","fromStatus","toStatus","actorId","actorName") VALUES($1,$2,NULL,'pending',$3,$4)`,
          [dealerId, orderId, v.id, dto.contactName.trim()],
        );
        if (voucher) await linkVoucherClaim(q, voucher.voucherId, v.id, orderId);
         if (serviceId) await q(
          `INSERT INTO agrilink_service_bookings(service_id,organization_id,booking_date,session,agrilink_order_id) VALUES($1,$2,$3,$4,$5)`,
           [serviceId, dealerId, extras.scheduledDate, extras.scheduledSession, orderId],
        );
        await notifyDealerStaff(q, dealerId, v.id, orderId, 'pending');
        await postOrderCard(q, { id: orderId, requesterId: v.id, organizationId: dealerId });
        return orderId;
  }

  async myOrders(v: CommunityViewer, status?: string) {
    return this.db.query(
      `SELECT a.id,a.code,a.kind,a.status,a.fulfillment,a."contactName",a."contactPhone",
         a."estimatedTotal"::float AS "estimatedTotal",a."finalTotal"::float AS "finalTotal",a."discountAmount"::float AS "discountAmount",a."voucherSnapshot"->>'title' AS "voucherTitle",a."createdAt",
         (SELECT count(*)::int FROM agrilink_order_items i WHERE i."orderId"=a.id) AS "itemCount",
         json_build_object('id',o.id,'name',o.name) AS dealer
       FROM agrilink_orders a JOIN agrilink_organizations o ON o.id=a."organizationId"
       WHERE a."requesterId"=$1 AND ($2::text IS NULL OR a.status=$2) ORDER BY a."createdAt" DESC LIMIT 100`,
      [v.id, status ?? null],
    );
  }

  async myOrder(v: CommunityViewer, id: string) {
    const [order] = await this.db.query(
      `SELECT a.id,a.code,a.kind,a.status,a.fulfillment,a.address,a.note,a."contactName",a."contactPhone",
         a."estimatedTotal"::float AS "estimatedTotal",a."finalTotal"::float AS "finalTotal",a."discountAmount"::float AS "discountAmount",a."voucherSnapshot"->>'title' AS "voucherTitle",
         a."rejectReason",a."cancelReason",a."createdAt",a."completedAt",a."posRefType",a."posRefId",a."organizationId",a."intentId",a."scheduledDate"::text AS "scheduledDate",a."scheduledSession",
         json_build_object('id',o.id,'name',o.name,'phone',o.phone,'address',o.address) AS dealer
       FROM agrilink_orders a JOIN agrilink_organizations o ON o.id=a."organizationId"
       WHERE a.id=$1 AND a."requesterId"=$2`,
      [id, v.id],
    );
    if (!order) throw new NotFoundException('Không tìm thấy đơn.');
    const items = await this.db.query(
      `SELECT id,"offerId","productId","commodityType","cropId","itemName",unit,quantity::float AS quantity,"unitPrice"::float AS "unitPrice",
         "finalQuantity"::float AS "finalQuantity","finalUnitPrice"::float AS "finalUnitPrice"
       FROM agrilink_order_items WHERE "orderId"=$1 ORDER BY "itemName"`,
      [id],
    );
    const events = await this.db.query(
      `SELECT "fromStatus","toStatus","actorName",note,"createdAt" FROM agrilink_order_events WHERE "orderId"=$1 ORDER BY "createdAt"`,
      [id],
    );
    const { posRefType, posRefId, organizationId, ...rest } = order;
    // This path runs as the table owner (no tenant RLS scope for a buyer
    // browsing across dealers), so filter orders/weighing_slips by the
    // order's own organizationId explicitly, same as agrilink-orders.service
    // detail() gets for free under RLS.
    let posRef: {
      type: string;
      id: string;
      code: string;
      status: string;
    } | null = null;
    if (posRefType === 'order' && posRefId) {
      const [r] = await this.db.query(
        `SELECT "orderCode" AS code, status FROM orders WHERE id=$1 AND "organizationId"=$2`,
        [posRefId, organizationId],
      );
      posRef = {
        type: 'order',
        id: posRefId,
        code: r?.code ?? '',
        status: r?.status ?? 'deleted',
      };
    } else if (posRefType === 'weighing_slip' && posRefId) {
      const [r] = await this.db.query(
        `SELECT "slipCode" AS code, "paymentStatus" AS status FROM weighing_slips WHERE id=$1 AND "organizationId"=$2`,
        [posRefId, organizationId],
      );
      posRef = {
        type: 'weighing_slip',
        id: posRefId,
        code: r?.code ?? '',
        status: r?.status ?? 'deleted',
      };
    }
    const rating = await this.trust?.ownRating(v.id,id) ?? null;
    return {
      ...rest,
      rating,
      canRate: rest.status === 'completed' && !!rest.completedAt && Date.now()-new Date(rest.completedAt).getTime() <= 14*86400000 && !rating,
      itemCount: items.length,
      items,
      events,
      posRef,
    };
  }

  async cancelMyOrder(v: CommunityViewer, id: string, reason?: string) {
    await this.db.transaction(async (em) => {
      const q = (sql: string, p: unknown[]) => em.query(sql, p);
      const [order] = await q(
         `SELECT id,code,status,fulfillment,"organizationId","requesterId","intentId","voucherId" FROM agrilink_orders WHERE id=$1 AND "requesterId"=$2 FOR UPDATE`,
        [id, v.id],
      );
      if (!order) throw new NotFoundException('Không tìm thấy đơn.');
      const to = nextStatus(order, 'cancel', { side: 'buyer' });
      await q(
        `UPDATE agrilink_orders SET status=$2,"cancelReason"=$3,"cancelledBy"='buyer',"updatedAt"=now() WHERE id=$1`,
        [id, to, reason?.trim() || null],
      );
      const [me] = await q(`SELECT "fullName" FROM users WHERE id=$1`, [v.id]);
      await q(
        `INSERT INTO agrilink_order_events("organizationId","orderId","fromStatus","toStatus","actorId","actorName",note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [
          order.organizationId,
          id,
          order.status,
          to,
          v.id,
          me?.fullName ?? 'Người mua',
          reason?.trim() || '',
        ],
      );
       await q(`UPDATE agrilink_service_bookings SET status='cancelled' WHERE agrilink_order_id=$1 AND status='active'`, [id]);
       await releaseVoucher(q, { id, voucherId: order.voucherId ?? null });
       if (order.intentId) {
         await q(`UPDATE agrilink_intents SET status=CASE WHEN window_end >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date THEN 'open' ELSE 'expired' END,updated_at=now() WHERE id=$1 AND status='matched'`, [order.intentId]);
         await q(`UPDATE agrilink_intent_offers SET status='expired',updated_at=now() WHERE intent_id=$1 AND status='accepted'`, [order.intentId]);
       }
      await notifyDealerStaff(q, order.organizationId, v.id, id, to);
      await postOrderStatusLine(q, order, to);
    });
    return this.myOrder(v, id);
  }
}
