import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import {
  NOTIFICATION_EVENT_DEFINITIONS,
  renderNotification,
  type NotificationEventType,
  type NotificationRenderContext,
} from './notification.events';
import {
  dedupeRecipients,
  normalizeRecipient,
  withoutActor,
  type NotificationRecipient,
} from './notification.recipients';

const RETENTION_DAYS = 90;

export type CreateNotificationInput = {
  actionExpiresAt?: Date;
  actorUserId?: string;
  context?: NotificationRenderContext;
  dedupeKey: string;
  eventType: NotificationEventType;
  includeActor?: boolean;
  metadata?: Record<string, unknown>;
  organizationId?: string;
  recipients: NotificationRecipient[];
  resourceId?: string;
  resourceType?: string;
  retainUntil?: Date;
};

export type NotificationInsertValues = {
  action_expires_at: Date | null;
  action_url: string | null;
  actor_user_id: string | null;
  body: string;
  category: string;
  created_at: Date;
  dedupe_key: string;
  event_type: string;
  metadata: Record<string, unknown>;
  organization_id: string | null;
  priority: string;
  recipient_email: string | null;
  recipient_user_id: string | null;
  resource_id: string | null;
  resource_type: string | null;
  retain_until: Date;
  title: string;
  updated_at: Date;
};

function addRetentionDays(value: Date): Date {
  const retained = new Date(value);
  retained.setUTCDate(retained.getUTCDate() + RETENTION_DAYS);
  return retained;
}

function recipientDedupePart(recipient: NotificationRecipient): string {
  return recipient.userId
    ? `user:${recipient.userId}`
    : `email:${recipient.email}`;
}

export function buildNotificationInsertValues(
  input: Omit<CreateNotificationInput, 'recipients'>,
  recipientInput: NotificationRecipient,
  now = new Date(),
): NotificationInsertValues {
  const recipient = normalizeRecipient(recipientInput);
  const context = input.context ?? {};
  const rendered = renderNotification(input.eventType, context);
  const eventDefinition = NOTIFICATION_EVENT_DEFINITIONS[input.eventType];

  return {
    action_expires_at: input.actionExpiresAt ?? null,
    action_url: rendered.actionUrl,
    actor_user_id: input.actorUserId ?? null,
    body: rendered.body,
    category: eventDefinition.category,
    created_at: now,
    dedupe_key: `${input.dedupeKey}:${recipientDedupePart(recipient)}`,
    event_type: input.eventType,
    metadata: input.metadata ?? {},
    organization_id: input.organizationId ?? null,
    priority: eventDefinition.priority,
    recipient_email: recipient.email ?? null,
    recipient_user_id: recipient.userId ?? null,
    resource_id: input.resourceId ?? null,
    resource_type: input.resourceType ?? null,
    retain_until: input.retainUntil ?? addRetentionDays(now),
    title: rendered.title,
    updated_at: now,
  };
}

@Injectable()
export class NotificationWriter {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async clearInvitationActions(
    invitationId: string,
    db: Database | any = this.db,
  ): Promise<void> {
    await db
      .updateTable('notification.notifications')
      .set({
        action_expires_at: null,
        action_url: null,
        updated_at: new Date(),
      })
      .where('resource_type', '=', 'invitation')
      .where('resource_id', '=', invitationId)
      .execute();
  }

  async create(
    input: CreateNotificationInput,
    db: Database | any = this.db,
  ): Promise<unknown[]> {
    const recipients = input.includeActor
      ? dedupeRecipients(input.recipients)
      : withoutActor(dedupeRecipients(input.recipients), input.actorUserId);

    if (recipients.length === 0) {
      return [];
    }

    const now = new Date();
    const rows = recipients.map((recipient) =>
      buildNotificationInsertValues(input, recipient, now),
    );

    const inserted = await db
      .insertInto('notification.notifications')
      .values(rows as any)
      .onConflict((conflict: any) => conflict.column('dedupe_key').doNothing())
      .returningAll()
      .execute();

    for (const row of inserted as Array<{
      event_type?: string | null;
      organization_id?: string | null;
      recipient_user_id?: string | null;
      resource_id?: string | null;
      resource_type?: string | null;
    }>) {
      if (row.recipient_user_id) {
        await (db as any).executeQuery({
          parameters: [
            'notification_changed',
            JSON.stringify({
              eventType: row.event_type ?? undefined,
              organizationId: row.organization_id ?? undefined,
              resourceId: row.resource_id ?? undefined,
              resourceType: row.resource_type ?? undefined,
              userId: row.recipient_user_id,
            }),
          ],
          sql: 'select pg_notify($1, $2)',
        });
      }
    }

    return inserted;
  }
}
