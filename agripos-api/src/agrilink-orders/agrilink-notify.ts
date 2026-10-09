export type Query = (sql: string, params: unknown[]) => Promise<any[]>;

export async function notifyUsers(
  query: Query,
  recipientIds: string[],
  actorId: string,
  orderId: string,
  status: string,
): Promise<void> {
  for (const id of new Set(recipientIds)) {
    if (id === actorId) continue;
    await query(
      `INSERT INTO community_notifications(recipient_id,actor_id,kind,event_key) VALUES($1,$2,'agrilink_order',$3) ON CONFLICT DO NOTHING`,
      [id, actorId, `agrilink:${orderId}:${status}`],
    );
  }
}

export async function notifyDealerStaff(
  query: Query,
  organizationId: string,
  actorId: string,
  orderId: string,
  status: string,
): Promise<void> {
  const rows = await query(
    `SELECT m.user_id FROM agrilink_memberships m JOIN users u ON u.id=m.user_id
     WHERE m.organization_id=$1 AND m.active AND u.role IN ('owner','manager','cashier')`,
    [organizationId],
  );
  await notifyUsers(
    query,
    rows.map((r) => r.user_id),
    actorId,
    orderId,
    status,
  );
}
