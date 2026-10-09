const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function vnDateStamp(d: Date = new Date()): string {
  return fmt.format(d).replace(/-/g, '');
}

export async function nextAgrilinkCode(
  query: (sql: string, params: unknown[]) => Promise<any[]>,
  organizationId: string,
  d: Date = new Date(),
): Promise<string> {
  const prefix = `AL-${vnDateStamp(d)}-`;
  const rows = await query(
    `SELECT MAX(CAST(SUBSTRING(code FROM '\\d+$') AS INTEGER)) AS max_num FROM agrilink_orders WHERE "organizationId"=$1 AND code LIKE $2`,
    [organizationId, `${prefix}%`],
  );
  return `${prefix}${String((rows[0]?.max_num || 0) + 1).padStart(3, '0')}`;
}
