import type { Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('admin.players')
		.addColumn('position', 'varchar(40)', (column) =>
			column.notNull().defaultTo('unspecified'),
		)
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.alterTable('admin.players').dropColumn('position').execute()
}
