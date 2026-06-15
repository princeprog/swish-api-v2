import type { Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createSchema('auth').ifNotExists().execute()

	await db.schema
		.createTable('auth.users')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('email', 'varchar(320)', (column) => column.notNull().unique())
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('email_verified', 'boolean', (column) =>
			column.notNull().defaultTo(false),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createTable('auth.auth_accounts')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('user_id', 'uuid', (column) =>
			column.notNull().references('auth.users.id').onDelete('cascade'),
		)
		.addColumn('provider', 'varchar(80)', (column) => column.notNull())
		.addColumn('provider_account_id', 'varchar(255)', (column) =>
			column.notNull(),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('auth_accounts_provider_account_unique', [
			'provider',
			'provider_account_id',
		])
		.execute()

	await db.schema
		.createIndex('auth_accounts_user_id_index')
		.on('auth.auth_accounts')
		.column('user_id')
		.execute()

	await db.schema
		.createTable('auth.auth_sessions')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('user_id', 'uuid', (column) =>
			column.notNull().references('auth.users.id').onDelete('cascade'),
		)
		.addColumn('session_token', 'varchar(255)', (column) =>
			column.notNull().unique(),
		)
		.addColumn('expires_at', 'timestamptz', (column) => column.notNull())
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createIndex('auth_sessions_user_id_index')
		.on('auth.auth_sessions')
		.column('user_id')
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('auth.auth_sessions').ifExists().execute()
	await db.schema.dropTable('auth.auth_accounts').ifExists().execute()
	await db.schema.dropTable('auth.users').ifExists().execute()
	await db.schema.dropSchema('auth').ifExists().execute()
}
