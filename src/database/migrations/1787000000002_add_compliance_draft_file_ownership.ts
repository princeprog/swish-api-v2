import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('compliance.submission_files')
		.alterColumn('submission_attempt_id', (column) => column.dropNotNull())
		.addColumn('submission_id', 'uuid', (column) =>
			column.references('compliance.team_submissions.id').onDelete('cascade'),
		)
		.execute()

	await db.schema
		.createIndex('compliance_submission_files_submission_id_index')
		.on('compliance.submission_files')
		.column('submission_id')
		.execute()

	await sql`
		alter table compliance.submission_files
		add constraint compliance_submission_files_owner_check
		check (submission_id is not null or submission_attempt_id is not null)
	`.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		alter table compliance.submission_files
		drop constraint if exists compliance_submission_files_owner_check
	`.execute(db)
	await sql`
		drop index if exists compliance.compliance_submission_files_submission_id_index
	`.execute(db)
	await db.schema
		.alterTable('compliance.submission_files')
		.dropColumn('submission_id')
		.alterColumn('submission_attempt_id', (column) => column.setNotNull())
		.execute()
}
