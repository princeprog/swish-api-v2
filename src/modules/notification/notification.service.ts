import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  normalizeNotificationLimit,
} from './notification.pagination';
import { normalizeRecipient } from './notification.recipients';
import type { NotificationListQueryDto } from './dto/notification-list-query.dto';

type NotificationRow = {
  action_expires_at: Date | null;
  action_url: string | null;
  body: string;
  category: string;
  created_at: Date;
  event_type: string;
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_slug: string | null;
  priority: string;
  read_at: Date | null;
  resource_id: string | null;
  resource_type: string | null;
  title: string;
};

export type NotificationListItem = {
  actionExpiresAt: Date | null;
  actionUrl: string | null;
  body: string;
  category: string;
  createdAt: Date;
  eventType: string;
  id: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  priority: string;
  readAt: Date | null;
  resource: {
    id: string;
    type: string;
  } | null;
  title: string;
};

export type NotificationListResult = {
  items: NotificationListItem[];
  nextCursor: string | null;
  unreadCount: number;
};

export function serializeNotificationRow(
  row: NotificationRow,
): NotificationListItem {
  return {
    actionExpiresAt: row.action_expires_at,
    actionUrl: row.action_url,
    body: row.body,
    category: row.category,
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    organization:
      row.organization_id && row.organization_name && row.organization_slug
        ? {
            id: row.organization_id,
            name: row.organization_name,
            slug: row.organization_slug,
          }
        : null,
    priority: row.priority,
    readAt: row.read_at,
    resource:
      row.resource_id && row.resource_type
        ? { id: row.resource_id, type: row.resource_type }
        : null,
    title: row.title,
  };
}

@Injectable()
export class NotificationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(
    userId: string,
    email: string,
    query: NotificationListQueryDto,
  ): Promise<NotificationListResult> {
    const limit = normalizeNotificationLimit(query.limit);
    const targetEmail = normalizeRecipient({ email }).email!;
    const baseQuery = this.db
      .selectFrom('notification.notifications as notifications')
      .leftJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'notifications.organization_id',
      )
      .select([
        'notifications.action_expires_at',
        'notifications.action_url',
        'notifications.body',
        'notifications.category',
        'notifications.created_at',
        'notifications.event_type',
        'notifications.id',
        'notifications.organization_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
        'notifications.priority',
        'notifications.read_at',
        'notifications.resource_id',
        'notifications.resource_type',
        'notifications.title',
      ]);

    let notificationQuery = (baseQuery as any).where((eb: any) =>
      eb.or([
        eb('notifications.recipient_user_id', '=', userId),
        eb.and([
          eb('notifications.recipient_user_id', 'is', null),
          eb('notifications.recipient_email', '=', targetEmail),
        ]),
      ]),
    );

    if (query.status === 'unread') {
      notificationQuery = notificationQuery.where(
        'notifications.read_at',
        'is',
        null,
      );
    }

    if (query.category) {
      notificationQuery = notificationQuery.where(
        'notifications.category',
        '=',
        query.category,
      );
    }

    if (query.organizationId) {
      notificationQuery = notificationQuery.where(
        'notifications.organization_id',
        '=',
        query.organizationId,
      );
    }

    if (query.cursor) {
      let cursor;
      try {
        cursor = decodeNotificationCursor(query.cursor);
      } catch {
        throw new BadRequestException('This notification page is not valid.');
      }

      notificationQuery = notificationQuery.where((eb: any) =>
        eb.or([
          eb('notifications.created_at', '<', cursor.createdAt),
          eb.and([
            eb('notifications.created_at', '=', cursor.createdAt),
            eb('notifications.id', '<', cursor.id),
          ]),
        ]),
      );
    }

    const rows = (await notificationQuery
      .orderBy('notifications.created_at', 'desc')
      .orderBy('notifications.id', 'desc')
      .limit(limit + 1)
      .execute()) as NotificationRow[];
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = visibleRows.at(-1);

    return {
      items: visibleRows.map(serializeNotificationRow),
      nextCursor:
        hasMore && lastRow
          ? encodeNotificationCursor(lastRow.created_at, lastRow.id)
          : null,
      unreadCount: await this.unreadCount(userId, email),
    };
  }

  async unreadCount(userId: string, email: string): Promise<number> {
    const targetEmail = normalizeRecipient({ email }).email!;
    const row = await (this.db as any)
      .selectFrom('notification.notifications')
      .select(({ fn }: any) => fn.count('id').as('count'))
      .where('read_at', 'is', null)
      .where((eb: any) =>
        eb.or([
          eb('recipient_user_id', '=', userId),
          eb.and([
            eb('recipient_user_id', 'is', null),
            eb('recipient_email', '=', targetEmail),
          ]),
        ]),
      )
      .executeTakeFirst();

    return Number(row?.count ?? 0);
  }

  async setRead(
    userId: string,
    email: string,
    notificationId: string,
    read: boolean,
  ) {
    const targetEmail = normalizeRecipient({ email }).email!;
    const updated = await (this.db as any)
      .updateTable('notification.notifications')
      .set({ read_at: read ? new Date() : null, updated_at: new Date() })
      .where('id', '=', notificationId)
      .where((eb: any) =>
        eb.or([
          eb('recipient_user_id', '=', userId),
          eb.and([
            eb('recipient_user_id', 'is', null),
            eb('recipient_email', '=', targetEmail),
          ]),
        ]),
      )
      .returning(['id', 'read_at'])
      .executeTakeFirst();

    if (!updated) {
      throw new NotFoundException('This notification is no longer available.');
    }

    return { id: updated.id, read: updated.read_at !== null };
  }

  async markAllRead(userId: string, email: string, organizationId?: string) {
    const targetEmail = normalizeRecipient({ email }).email!;
    let updateQuery = (this.db as any)
      .updateTable('notification.notifications')
      .set({ read_at: new Date(), updated_at: new Date() })
      .where('read_at', 'is', null)
      .where((eb: any) =>
        eb.or([
          eb('recipient_user_id', '=', userId),
          eb.and([
            eb('recipient_user_id', 'is', null),
            eb('recipient_email', '=', targetEmail),
          ]),
        ]),
      );

    if (organizationId) {
      updateQuery = updateQuery.where(
        'organization_id',
        '=',
        organizationId,
      );
    }

    const result = await updateQuery.executeTakeFirst();
    return { updatedCount: Number(result?.numUpdatedRows ?? 0) };
  }
}
