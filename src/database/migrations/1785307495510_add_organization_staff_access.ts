import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createSchema('access').ifNotExists().execute()

	await sql`
		update admin.organization_members
		set
			role = case
				when role = 'scorer' then 'scorekeeper'
				when role = 'coach' then 'team_manager'
				else role
			end,
			status = case
				when status = 'inactive' or role = 'player' then 'suspended'
				else status
			end,
			updated_at = now()
		where role in ('scorer', 'coach', 'player')
			or status = 'inactive'
	`.execute(db)

	await db.schema
		.createTable('access.organization_invitations')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_id', 'uuid', (column) =>
			column.notNull().references('admin.organizations.id').onDelete('cascade'),
		)
		.addColumn('email', 'varchar(320)', (column) => column.notNull())
		.addColumn('role', 'varchar(80)', (column) => column.notNull())
		.addColumn('token_hash', 'varchar(128)', (column) => column.notNull().unique())
		.addColumn('status', 'varchar(40)', (column) =>
			column.notNull().defaultTo('pending'),
		)
		.addColumn('invited_by_member_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organization_members.id')
				.onDelete('restrict'),
		)
		.addColumn('accepted_by_member_id', 'uuid', (column) =>
			column.references('admin.organization_members.id').onDelete('set null'),
		)
		.addColumn('expires_at', 'timestamptz', (column) => column.notNull())
		.addColumn('accepted_at', 'timestamptz')
		.addColumn('revoked_at', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await sql`
		create unique index organization_invitations_one_pending_per_email
		on access.organization_invitations (organization_id, email)
		where status = 'pending'
	`.execute(db)

	await db.schema
		.createIndex('organization_invitations_organization_id_index')
		.on('access.organization_invitations')
		.column('organization_id')
		.execute()

	await db.schema
		.createTable('access.team_manager_assignments')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_member_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organization_members.id')
				.onDelete('cascade'),
		)
		.addColumn('team_id', 'uuid', (column) =>
			column.notNull().references('admin.teams.id').onDelete('cascade'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('team_manager_assignments_member_team_unique', [
			'organization_member_id',
			'team_id',
		])
		.execute()

	await db.schema
		.createIndex('team_manager_assignments_team_id_index')
		.on('access.team_manager_assignments')
		.column('team_id')
		.execute()

	await db.schema
		.createTable('access.game_scorekeeper_assignments')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_member_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organization_members.id')
				.onDelete('cascade'),
		)
		.addColumn('game_id', 'uuid', (column) =>
			column.notNull().references('competition.games.id').onDelete('cascade'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('game_scorekeeper_assignments_member_game_unique', [
			'organization_member_id',
			'game_id',
		])
		.execute()

	await db.schema
		.createIndex('game_scorekeeper_assignments_game_id_index')
		.on('access.game_scorekeeper_assignments')
		.column('game_id')
		.execute()

	await db.schema
		.createTable('access.audit_events')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('organization_id', 'uuid', (column) =>
			column.notNull().references('admin.organizations.id').onDelete('cascade'),
		)
		.addColumn('actor_member_id', 'uuid', (column) =>
			column.references('admin.organization_members.id').onDelete('set null'),
		)
		.addColumn('action', 'varchar(120)', (column) => column.notNull())
		.addColumn('target_type', 'varchar(80)', (column) => column.notNull())
		.addColumn('target_id', 'uuid')
		.addColumn('metadata', 'jsonb', (column) =>
			column.notNull().defaultTo(sql`'{}'::jsonb`),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createIndex('audit_events_organization_id_index')
		.on('access.audit_events')
		.column('organization_id')
		.execute()
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable('access.audit_events').ifExists().execute()
	await db.schema
		.dropTable('access.game_scorekeeper_assignments')
		.ifExists()
		.execute()
	await db.schema
		.dropTable('access.team_manager_assignments')
		.ifExists()
		.execute()
	await db.schema
		.dropTable('access.organization_invitations')
		.ifExists()
		.execute()
	await db.schema.dropSchema('access').ifExists().execute()

	await sql`
		update admin.organization_members
		set
			role = case
				when role = 'scorekeeper' then 'scorer'
				when role = 'team_manager' then 'coach'
				else role
			end,
			status = case
				when status = 'suspended' then 'inactive'
				else status
			end,
			updated_at = now()
		where role in ('scorekeeper', 'team_manager')
			or status = 'suspended'
	`.execute(db)
}
