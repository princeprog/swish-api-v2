import type { Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('compliance.division_settings')
		.addColumn('instructions', 'text')
		.addColumn('submission_deadline_at', 'timestamptz')
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('compliance.division_settings')
		.dropColumn('submission_deadline_at')
		.dropColumn('instructions')
		.execute()
}
