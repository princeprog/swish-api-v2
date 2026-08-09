import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations are frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('notification').ifNotExists().execute();

  await db.schema
    .createTable('notification.notifications')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('recipient_user_id', 'uuid', (column) =>
      column.references('auth.users.id').onDelete('set null'),
    )
    .addColumn('recipient_email', 'varchar(320)')
    .addColumn('organization_id', 'uuid', (column) =>
      column.references('admin.organizations.id').onDelete('set null'),
    )
    .addColumn('event_type', 'varchar(120)', (column) => column.notNull())
    .addColumn('category', 'varchar(40)', (column) => column.notNull())
    .addColumn('priority', 'varchar(40)', (column) => column.notNull())
    .addColumn('title', 'varchar(200)', (column) => column.notNull())
    .addColumn('body', 'varchar(1200)', (column) => column.notNull())
    .addColumn('action_url', 'varchar(600)')
    .addColumn('action_expires_at', 'timestamptz')
    .addColumn('actor_user_id', 'uuid', (column) =>
      column.references('auth.users.id').onDelete('set null'),
    )
    .addColumn('resource_type', 'varchar(80)')
    .addColumn('resource_id', 'uuid')
    .addColumn('dedupe_key', 'varchar(255)', (column) => column.notNull())
    .addColumn('metadata', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('read_at', 'timestamptz')
    .addColumn('retain_until', 'timestamptz', (column) =>
      column.notNull().defaultTo(sql`now() + interval '90 days'`),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('notifications_dedupe_key_unique', ['dedupe_key'])
    .addCheckConstraint(
      'notifications_recipient_check',
      sql`recipient_user_id is not null or recipient_email is not null`,
    )
    .addCheckConstraint(
      'notifications_category_check',
      sql`category in ('access', 'roster', 'schedule', 'scoring', 'competition')`,
    )
    .addCheckConstraint(
      'notifications_priority_check',
      sql`priority in ('action_required', 'important', 'informational')`,
    )
    .execute();

  await db.schema
    .createIndex('notification_recipient_user_created_index')
    .on('notification.notifications')
    .columns(['recipient_user_id', 'created_at', 'id'])
    .execute();

  await db.schema
    .createIndex('notification_recipient_email_created_index')
    .on('notification.notifications')
    .columns(['recipient_email', 'created_at', 'id'])
    .execute();

  await sql`
    create index notification_unread_recipient_index
    on notification.notifications (recipient_user_id, created_at desc)
    where read_at is null and recipient_user_id is not null
  `.execute(db);

  await db.schema
    .createIndex('notification_organization_created_index')
    .on('notification.notifications')
    .columns(['organization_id', 'created_at', 'id'])
    .execute();

  await db.schema
    .createIndex('notification_retention_index')
    .on('notification.notifications')
    .column('retain_until')
    .execute();
});

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('notification_retention_index')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('notification_organization_created_index')
    .ifExists()
    .execute();
  await sql`
    drop index if exists notification.notification_unread_recipient_index
  `.execute(db);
  await db.schema
    .dropIndex('notification_recipient_email_created_index')
    .ifExists()
    .execute();
  await db.schema
    .dropIndex('notification_recipient_user_created_index')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('notification.notifications')
    .ifExists()
    .execute();
  await db.schema.dropSchema('notification').ifExists().execute();
}
