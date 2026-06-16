import type { Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('auth.auth_sessions')
		.renameColumn('session_token', 'session_token_hash')
		.execute()

	await db.schema
		.alterTable('auth.auth_sessions')
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('revoked_at', 'timestamptz')
		.execute()

	await db.schema
		.createTable('auth.password_credentials')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('user_id', 'uuid', (column) =>
			column.notNull().unique().references('auth.users.id').onDelete('cascade'),
		)
		.addColumn('password_hash', 'varchar(255)', (column) => column.notNull())
		.addColumn('password_updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createIndex('password_credentials_user_id_index')
		.on('auth.password_credentials')
		.column('user_id')
		.execute()

	await db.schema
		.createTable('auth.refresh_tokens')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('user_id', 'uuid', (column) =>
			column.notNull().references('auth.users.id').onDelete('cascade'),
		)
		.addColumn('session_id', 'uuid', (column) =>
			column.notNull().references('auth.auth_sessions.id').onDelete('cascade'),
		)
		.addColumn('token_hash', 'varchar(255)', (column) =>
			column.notNull().unique(),
		)
		.addColumn('expires_at', 'timestamptz', (column) => column.notNull())
		.addColumn('revoked_at', 'timestamptz')
		.addColumn('rotated_from_token_id', 'uuid', (column) =>
			column.references('auth.refresh_tokens.id').onDelete('set null'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createIndex('refresh_tokens_user_id_index')
		.on('auth.refresh_tokens')
		.column('user_id')
		.execute()

	await db.schema
		.createIndex('refresh_tokens_session_id_index')
		.on('auth.refresh_tokens')
		.column('session_id')
		.execute()

	await db.schema
		.createIndex('refresh_tokens_rotated_from_token_id_index')
		.on('auth.refresh_tokens')
		.column('rotated_from_token_id')
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('auth.refresh_tokens').ifExists().execute()
	await db.schema.dropTable('auth.password_credentials').ifExists().execute()

	await db.schema
		.alterTable('auth.auth_sessions')
		.dropColumn('revoked_at')
		.dropColumn('updated_at')
		.execute()

	await db.schema
		.alterTable('auth.auth_sessions')
		.renameColumn('session_token_hash', 'session_token')
		.execute()
}
