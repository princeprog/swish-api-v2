import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('access.invitation_team_assignments')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('invitation_id', 'uuid', (column) =>
			column
				.notNull()
				.references('access.organization_invitations.id')
				.onDelete('cascade'),
		)
		.addColumn('team_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.teams.id')
				.onDelete('cascade'),
		)
		.addColumn('league_season_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.league_seasons.id')
				.onDelete('cascade'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('invitation_team_assignments_invitation_season_unique', [
			'invitation_id',
			'league_season_id',
		])
		.execute()

	await db.schema
		.createIndex('invitation_team_assignments_invitation_id_index')
		.on('access.invitation_team_assignments')
		.column('invitation_id')
		.execute()

	await db.schema
		.createIndex('invitation_team_assignments_team_id_index')
		.on('access.invitation_team_assignments')
		.column('team_id')
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		drop index if exists access.invitation_team_assignments_team_id_index
	`.execute(db)

	await sql`
		drop index if exists access.invitation_team_assignments_invitation_id_index
	`.execute(db)

	await db.schema
		.dropTable('access.invitation_team_assignments')
		.execute()
}
