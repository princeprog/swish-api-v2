export type ArchiveActor = {
  membershipId?: string;
};

export async function lockArchiveRecord(trx: any, table: string, id: string) {
  let query = trx.selectFrom(table).selectAll().where('id', '=', id);
  if (typeof query.forUpdate === 'function') {
    query = query.forUpdate();
  }
  return query.executeTakeFirst();
}

export async function archiveRecord(
  trx: any,
  table: string,
  id: string,
  now = new Date(),
) {
  return trx
    .updateTable(table)
    .set({ archived_at: now, updated_at: now })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function restoreRecord(
  trx: any,
  table: string,
  id: string,
  now = new Date(),
) {
  return trx
    .updateTable(table)
    .set({ archived_at: null, updated_at: now })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function writeArchiveAudit(
  trx: any,
  input: {
    action: string;
    actor?: ArchiveActor;
    organizationId: string;
    targetId: string;
    targetType: string;
  },
) {
  await trx
    .insertInto('access.audit_events')
    .values({
      action: input.action,
      actor_member_id: input.actor?.membershipId ?? null,
      metadata: {},
      organization_id: input.organizationId,
      target_id: input.targetId,
      target_type: input.targetType,
    })
    .execute();
}
