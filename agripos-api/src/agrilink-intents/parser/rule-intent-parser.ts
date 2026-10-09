import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { normalizeVi } from '../../agri-reference/normalize';
import { completeIntent } from './complete-intent';
import { IntentParser, ParseContext, ParsedIntent } from './intent-parser';

type CropAlias = { alias_norm: string; id: string; name: string };
type PlaceAlias = {
  alias_norm: string;
  province_code: string;
  commune_code: string | null;
};
const words = 'mot hai ba bon nam sau bay tam chin muoi nua'.split(' ');
const wordNumber: Record<string, number> = Object.fromEntries(
  words.map((w, i) => [w, i === 10 ? 0.5 : i + 1]),
);
const day = 86400000;
const date = (d: Date) => d.toISOString().slice(0, 10);
const add = (d: Date, n: number) => new Date(d.getTime() + n * day);
const includesAlias = (s: string, a: string) => ` ${s} `.includes(` ${a} `);
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const number = (s: string): number => {
  if (wordNumber[s] !== undefined) return wordNumber[s];
  return Number(
    /^\d{1,3}(?:\.\d{3})+$/.test(s)
      ? s.replace(/\./g, '')
      : s.replace(',', '.'),
  );
};
const quantityPattern =
  /\b(?:(\d+(?:[.,]\d+)?|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|nua)\s*[-–]\s*)?(\d+(?:[.,]\d+)?|mot|hai|ba|bon|nam|sau|bay|tam|chin|muoi|nua)\s*(tan|ta|yen|kg|ki|ky|kilo|ky lo|can|t|bao|bich)\b(?:\s*ruoi)?/g;

@Injectable()
export class RuleIntentParser implements IntentParser, OnModuleInit {
  private crops: CropAlias[] = [];
  private places: PlaceAlias[] = [];
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.refreshAliases();
  }
  @Interval(600000)
  async refreshAliases() {
    const rows: { alias_norm: string | null; id: string; name: string }[] =
      await this.db.query(
        'SELECT a.alias_norm,c.id,c.name FROM agri_crops c LEFT JOIN agri_crop_aliases a ON a.crop_id=c.id WHERE c.active',
      );
    // Nông sản chưa có tên gọi khác (vd "Sắn lát khô") vẫn nhận ra được theo chính tên của nó.
    this.crops = rows.map((r) => ({
      ...r,
      alias_norm: r.alias_norm ?? normalizeVi(r.name),
    }));
    this.places = await this.db.query(
      'SELECT alias_norm,province_code,commune_code FROM admin_aliases',
    );
  }

  async parse(text: string, ctx: ParseContext): Promise<ParsedIntent> {
    const original = normalizeVi(text);
    const s = clean(
      text
        .toLowerCase()
        .replace(/đ/g, 'd')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’`]/g, '')
        .replace(/[^a-z0-9\s/.,-]/g, ' '),
    );
    const buy =
      /\b(can mua|muon mua|tim mua|mua|can phan|can thuoc|dat mua)\b/.test(
        original,
      );
    const sell = /\b(ban|can ban|muon ban|thanh ly|xuat)\b/.test(original);
    const cropHits = this.crops.filter(
      (a) =>
        a.alias_norm.split(' ').length <= 4 &&
        includesAlias(original, a.alias_norm),
    );
    const longest = Math.max(
      0,
      ...cropHits.map((a) => a.alias_norm.split(' ').length),
    );
    const genericCoffee =
      longest === 2 &&
      cropHits.some((a) => a.alias_norm === 'ca phe') &&
      includesAlias(original, 'ca phe');
    const coffeeNames = ['ca phe tuoi', 'ca phe nhan'];
    const candidateHits = genericCoffee
      ? this.crops
          .filter((a) => coffeeNames.includes(normalizeVi(a.name)))
          .sort(
            (a, b) =>
              coffeeNames.indexOf(normalizeVi(a.name)) -
              coffeeNames.indexOf(normalizeVi(b.name)),
          )
      : cropHits.filter((a) => a.alias_norm.split(' ').length === longest);
    const candidates = [
      ...new Map(
        candidateHits.map((a) => [a.id, { id: a.id, name: a.name }]),
      ).values(),
    ];
    const side =
      buy && !sell ? 'buy' : sell || (!buy && cropHits.length) ? 'sell' : null;
    const chosen = candidates.length === 1 ? candidates[0] : null;
    const placeHits = this.matchPlaces(original);
    const place = placeHits[0];
    const provinceCode =
      place?.province_code ?? ctx.defaultProvinceCode ?? null;
    const communeCode =
      place?.commune_code ?? (place ? null : (ctx.defaultCommuneCode ?? null));
    const placeSource = place ? 'text' : provinceCode ? 'profile' : null;

    const vn = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ctx.now);
    const today = new Date(`${vn}T00:00:00.000Z`);
    let start = today,
      end = add(today, 7);
    const explicit = s.match(/(?<![\d-])(\d{1,2})[/-](\d{1,2})\b(?!-\d)/);
    const calendarDate =
      explicit &&
      Number(explicit[2]) <= 12 &&
      !new RegExp(
        `\\b${explicit[0]}\\s*(tan|ta|yen|kg|ki|ky|kilo|can)\\b`,
      ).test(s);
    if (explicit && calendarDate) {
      let year = today.getUTCFullYear();
      let target = new Date(
        Date.UTC(year, Number(explicit[2]) - 1, Number(explicit[1])),
      );
      if (
        target.getUTCMonth() !== Number(explicit[2]) - 1 ||
        target.getUTCDate() !== Number(explicit[1])
      )
        target = today;
      if (target < today)
        target = new Date(
          Date.UTC(++year, Number(explicit[2]) - 1, Number(explicit[1])),
        );
      start = end = target;
    } else if (/\b(hom nay|trong ngay)\b/.test(s)) start = end = today;
    else if (/\b(ngay mai|mai)\b/.test(s)) start = end = add(today, 1);
    else if (
      /\b(ngay kia|ngay mot)\b/.test(s) ||
      (/\bmot\b/.test(s) &&
        !/\bmot\s*(tan|ta|yen|kg|ki|ky|kilo|can|bao|bich)\b/.test(s))
    )
      start = end = add(today, 2);
    else if (/\b(tuan sau|tuan toi)\b/.test(s)) {
      start = add(today, 8 - (today.getUTCDay() || 7));
      end = add(start, 6);
    } else if (/\b(cuoi tuan)\b/.test(s)) {
      start = add(today, (6 - today.getUTCDay() + 7) % 7);
      end = add(start, 1);
    } else if (/\b(tuan nay)\b/.test(s))
      end = add(today, 7 - (today.getUTCDay() || 7));
    else if (/\b(thang nay)\b/.test(s))
      end = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
      );
    else {
      const duration = s.match(
        /\b(?:trong\s+)?(\d+)\s+ngay(?:\s+(?:toi|nua))?\b/,
      );
      if (duration) end = add(today, Number(duration[1]));
    }

    let remainder = s;
    let quantityKg: number | null = null,
      quantityText = '';
    const qm = [...s.matchAll(quantityPattern)][0];
    if (qm) {
      quantityText = qm[0];
      const unit = qm[3],
        multiplier =
          unit === 'tan' || unit === 't'
            ? 1000
            : unit === 'ta'
              ? 100
              : unit === 'yen'
                ? 10
                : unit === 'bao' || unit === 'bich'
                  ? 0
                  : 1;
      if (multiplier)
        quantityKg =
          (number(qm[2]) + (/\bruoi$/.test(qm[0]) ? 0.5 : 0)) * multiplier;
      remainder = remainder.replace(qm[0], ' ');
    }
    let expectedPricePerKg: number | null = null;
    const pm = remainder.matchAll(
      /\b(?:(?:gia|khoang|tam)\s+)*\d+(?:[.,]\d+)?\s*(?:trieu|nghin|ngan|k|ng|dong|d)?\s*(?:\/\s*(?:kg|ky)|mot ky|1 ky)?\b/g,
    );
    for (const match of pm) {
      const p = match[0];
      if (
        !/\bgia\b|\d\s*(?:trieu|k|nghin|ngan|ng|dong|d)\b|\/\s*(?:kg|ky)\b|\b(?:mot|1) ky\b/.test(
          p,
        ) ||
        /^\s*(?:tan|ta|yen|kg|ki|ky|kilo|ky lo|can)\b/.test(
          remainder.slice(match.index + p.length),
        )
      )
        continue;
      const m = p.match(/(\d+(?:[.,]\d+)?)/);
      if (!m) continue;
      let n = number(m[1]);
      if (/trieu/.test(p)) n *= 1000000;
      else if (/\b(k|nghin|ngan|ng)\b/.test(p) || /\d+k\b/.test(p) || n < 1000)
        n *= 1000;
      if (n >= 1000 && n <= 2000000) {
        expectedPricePerKg = n;
        remainder = remainder.replace(p, ' ');
        break;
      }
    }
    const fulfillmentPref =
      side === 'sell'
        ? /\b(den lay|toi lay|lay tan (vuon|nha|noi)|thu mua tan (vuon|noi))\b/.test(
            s,
          )
          ? 'pickup'
          : /\b(tu cho|cho den|mang ra|cho ra)\b/.test(s)
            ? 'dropoff'
            : 'any'
        : /\b(giao tan (noi|nha|vuon)|ship)\b/.test(s)
          ? 'dropoff'
          : /\b(tu den lay|ra lay)\b/.test(s)
            ? 'pickup'
            : 'any';
    for (const phrase of [
      ...placeHits.map((a) => a.alias_norm),
      'can mua',
      'muon mua',
      'tim mua',
      'dat mua',
      'mua',
      'ban',
      'can ban',
      'muon ban',
      'thanh ly',
      'xuat',
      'hom nay',
      'trong ngay',
      'ngay mai',
      'mai',
      'ngay kia',
      'ngay mot',
      'tuan nay',
      'tuan sau',
      'tuan toi',
      'cuoi tuan',
      'thang nay',
      'giao tan nha',
      'giao tan noi',
      'giao tan vuon',
      'ship',
      'den lay',
      'toi lay',
      'tu den lay',
      'ra lay',
    ])
      remainder = remainder.replace(new RegExp(`\\b${phrase}\\b`, 'g'), ' ');
    remainder = remainder.replace(
      /\b(?:trong\s+)?\d+\s+ngay(?:\s+(?:toi|nua))?\b/g,
      ' ',
    );
    if (calendarDate && explicit)
      remainder = remainder.replace(explicit[0], ' ');
    remainder = remainder.replace(
      /\b(toi|minh|em|anh|chi|co|can|muon|khoang|tam|chung|duoc|nhe|a|oi|voi|cho|o|tai|nha|giao|tan)\b/g,
      ' ',
    );
    const productQuery =
      side === 'buy' && clean(remainder).length >= 2
        ? clean(remainder).slice(0, 200)
        : null;
    return completeIntent({
      parser: 'rules',
      side,
      cropId: side === 'sell' ? (chosen?.id ?? null) : null,
      cropName: side === 'sell' ? (chosen?.name ?? null) : null,
      cropCandidates: side === 'sell' ? candidates : [],
      productQuery,
      quantityKg,
      quantityText,
      provinceCode,
      communeCode,
      placeSource,
      windowStart: date(start),
      windowEnd: date(end),
      expectedPricePerKg,
      fulfillmentPref,
    });
  }

  /** Danh sách tên nông sản đang dùng (đưa cho mô hình ngôn ngữ chọn). */
  cropNames(): string[] {
    return [...new Set(this.crops.map((c) => c.name))];
  }

  /** Tên nông sản (hoặc tên gọi khác) → nông sản trong danh mục. */
  resolveCrop(name: string): { id: string; name: string } | null {
    const n = normalizeVi(name);
    const hit =
      this.crops.find((c) => normalizeVi(c.name) === n) ??
      this.crops.find((c) => c.alias_norm === n);
    return hit ? { id: hit.id, name: hit.name } : null;
  }

  /** Địa danh trong câu → tỉnh, xã; tên dài nhất và cụ thể nhất được ưu tiên. */
  matchPlaces(text: string): PlaceAlias[] {
    const s = normalizeVi(text);
    return this.places
      .filter(
        (a) =>
          a.alias_norm.split(' ').length <= 5 && includesAlias(s, a.alias_norm),
      )
      .sort(
        (a, b) =>
          b.alias_norm.split(' ').length - a.alias_norm.split(' ').length ||
          Number(!!b.commune_code) - Number(!!a.commune_code),
      );
  }
}
