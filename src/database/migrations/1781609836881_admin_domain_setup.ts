import type { Kysely } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createSchema('admin').ifNotExists().execute()

	await db.schema
		.createTable('admin.organizations')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('slug', 'varchar(160)', (column) => column.notNull().unique())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createTable('admin.organization_members')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organizations.id')
				.onDelete('cascade'),
		)
		.addColumn('user_id', 'uuid', (column) =>
			column.notNull().references('auth.users.id').onDelete('cascade'),
		)
		.addColumn('role', 'varchar(80)', (column) => column.notNull())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('organization_members_org_user_unique', [
			'organization_id',
			'user_id',
		])
		.execute()

	await db.schema
		.createIndex('organization_members_organization_id_index')
		.on('admin.organization_members')
		.column('organization_id')
		.execute()

	await db.schema
		.createIndex('organization_members_user_id_index')
		.on('admin.organization_members')
		.column('user_id')
		.execute()

	await db.schema
		.createTable('admin.league_seasons')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organizations.id')
				.onDelete('cascade'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('slug', 'varchar(160)', (column) => column.notNull())
		.addColumn('public_enabled', 'boolean', (column) =>
			column.notNull().defaultTo(false),
		)
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('draft'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('league_seasons_org_slug_unique', [
			'organization_id',
			'slug',
		])
		.execute()

	await db.schema
		.createIndex('league_seasons_organization_id_index')
		.on('admin.league_seasons')
		.column('organization_id')
		.execute()

	await db.schema
		.createTable('admin.divisions')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('league_season_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.league_seasons.id')
				.onDelete('cascade'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('slug', 'varchar(160)', (column) => column.notNull())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('divisions_league_season_slug_unique', [
			'league_season_id',
			'slug',
		])
		.execute()

	await db.schema
		.createIndex('divisions_league_season_id_index')
		.on('admin.divisions')
		.column('league_season_id')
		.execute()

	await db.schema
		.createTable('admin.teams')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('division_id', 'uuid', (column) =>
			column.notNull().references('admin.divisions.id').onDelete('cascade'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('slug', 'varchar(160)', (column) => column.notNull())
		.addColumn('color', 'varchar(32)')
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('teams_division_slug_unique', ['division_id', 'slug'])
		.execute()

	await db.schema
		.createIndex('teams_division_id_index')
		.on('admin.teams')
		.column('division_id')
		.execute()

	await db.schema
		.createTable('admin.players')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('team_id', 'uuid', (column) =>
			column.notNull().references('admin.teams.id').onDelete('cascade'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('jersey_number', 'varchar(20)', (column) => column.notNull())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('players_team_jersey_number_unique', [
			'team_id',
			'jersey_number',
		])
		.execute()

	await db.schema
		.createIndex('players_team_id_index')
		.on('admin.players')
		.column('team_id')
		.execute()

	await db.schema
		.createTable('admin.venues')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('league_season_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.league_seasons.id')
				.onDelete('cascade'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('slug', 'varchar(160)', (column) => column.notNull())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('active'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('venues_league_season_slug_unique', [
			'league_season_id',
			'slug',
		])
		.execute()

	await db.schema
		.createIndex('venues_league_season_id_index')
		.on('admin.venues')
		.column('league_season_id')
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('admin.venues').ifExists().execute()
	await db.schema.dropTable('admin.players').ifExists().execute()
	await db.schema.dropTable('admin.teams').ifExists().execute()
	await db.schema.dropTable('admin.divisions').ifExists().execute()
	await db.schema.dropTable('admin.league_seasons').ifExists().execute()
	await db.schema.dropTable('admin.organization_members').ifExists().execute()
	await db.schema.dropTable('admin.organizations').ifExists().execute()
	await db.schema.dropSchema('admin').ifExists().execute()
}
