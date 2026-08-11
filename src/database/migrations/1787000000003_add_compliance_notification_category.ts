import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
		alter table notification.notifications
		drop constraint if exists notifications_category_check
	`.execute(db);
  await sql`
		alter table notification.notifications
		add constraint notifications_category_check
		check (category in ('access', 'roster', 'schedule', 'scoring', 'competition', 'compliance'))
	`.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
		alter table notification.notifications
		drop constraint if exists notifications_category_check
	`.execute(db);
  await sql`
		alter table notification.notifications
		add constraint notifications_category_check
		check (category in ('access', 'roster', 'schedule', 'scoring', 'competition'))
	`.execute(db);
}
