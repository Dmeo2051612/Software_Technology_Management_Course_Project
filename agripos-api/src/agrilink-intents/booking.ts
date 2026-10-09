import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type Session = 'morning' | 'afternoon';
export const vnToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export const calendarDate = (value: string | Date) =>
  value instanceof Date ? vnToday(value) : String(value).slice(0, 10);
export function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
  );
}
export function slotStarts(date: string, session: Session): number {
  return Date.parse(`${date}T${session === 'morning' ? '00' : '06'}:00:00Z`);
}
export function bookable(
  date: string,
  session: Session,
  leadTimeHours: number,
  now = new Date(),
): boolean {
  return (
    validDate(date) &&
    slotStarts(date, session) >= now.getTime() + leadTimeHours * 3600000
  );
}
export const hasCapacity = (capacity: number, used: number) =>
  Number(capacity) > Number(used);
export async function serviceSlots(
  query: (sql: string, params: unknown[]) => Promise<any[]>,
  organizationId: string,
  kind: string,
  from: string,
  to: string,
) {
  if (
    !['farm_pickup', 'supply_delivery'].includes(kind) ||
    !validDate(from) ||
    !validDate(to) ||
    to < from ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 13
  )
    throw new BadRequestException('Khoảng ngày không hợp lệ hoặc quá 14 ngày.');
  const [service] = await query(
    `SELECT s.id,s.lead_time_hours FROM agrilink_dealer_services s
     JOIN agrilink_organizations o ON o.id=s.organization_id
     WHERE s.organization_id=$1 AND s.kind=$2 AND s.active AND o.marketplace_enabled`,
    [organizationId, kind],
  );
  if (!service) return [];
  const rows = await query(
    `SELECT d.day::date::text AS date,w.session,(w.capacity-count(b.id))::int AS remaining
    FROM generate_series($2::date,$3::date,interval '1 day') d(day)
    JOIN agrilink_service_windows w ON w.service_id=$1 AND w.weekday=extract(dow FROM d.day)
    LEFT JOIN agrilink_service_bookings b ON b.service_id=$1 AND b.booking_date=d.day::date AND b.session=w.session AND b.status='active'
    GROUP BY d.day,w.session,w.capacity ORDER BY d.day,w.session`,
    [service.id, from, to],
  );
  return rows.filter(
    (r) =>
      hasCapacity(r.remaining, 0) &&
      bookable(r.date, r.session, service.lead_time_hours),
  );
}
export async function lockSlot(
  em: EntityManager,
  organizationId: string,
  kind: string,
  date: string,
  session: Session,
): Promise<string> {
  const [service] = await em.query(
    'SELECT id,lead_time_hours FROM agrilink_dealer_services WHERE organization_id=$1 AND kind=$2 AND active FOR UPDATE',
    [organizationId, kind],
  );
  if (!service) throw new NotFoundException('Dịch vụ không khả dụng.');
  const [window] = await em.query(
    `SELECT w.capacity,(SELECT count(*)::int FROM agrilink_service_bookings b WHERE b.service_id=$1 AND b.booking_date=$2::date AND b.session=$3 AND b.status='active') AS used
    FROM agrilink_service_windows w WHERE w.service_id=$1 AND w.weekday=extract(dow FROM $2::date) AND w.session=$3`,
    [service.id, date, session],
  );
  if (
    !window ||
    !bookable(date, session, service.lead_time_hours) ||
    !hasCapacity(window.capacity, window.used)
  )
    throw new ConflictException('Buổi này đã hết chỗ');
  return service.id;
}
