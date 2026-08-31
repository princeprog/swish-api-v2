import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('access.team_manager_assignments')
		.addColumn('league_season_id', 'uuid', (column) =>
			column.references('admin.league_seasons.id').onDelete('cascade'),
		)
		.execute()

	await sql`
		update access.team_manager_assignments assignments
		set league_season_id = divisions.league_season_id
		from admin.teams teams
		inner join admin.divisions divisions on divisions.id = teams.division_id
		where teams.id = assignments.team_id
	`.execute(db)

	await sql`
		delete from access.team_manager_assignments assignments
		using access.team_manager_assignments duplicate_assignments
		where assignments.organization_member_id = duplicate_assignments.organization_member_id
			and assignments.league_season_id = duplicate_assignments.league_season_id
			and (
				assignments.created_at > duplicate_assignments.created_at
				or (
					assignments.created_at = duplicate_assignments.created_at
					and assignments.id::text > duplicate_assignments.id::text
				)
			)
	`.execute(db)

	await sql`
		alter table access.team_manager_assignments
		alter column league_season_id set not null
	`.execute(db)

	await db.schema
		.createIndex('team_manager_assignments_league_season_id_index')
		.on('access.team_manager_assignments')
		.column('league_season_id')
		.execute()

	await db.schema
		.alterTable('access.team_manager_assignments')
		.addUniqueConstraint('team_manager_assignments_member_season_unique', [
			'organization_member_id',
			'league_season_id',
		])
		.execute()
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('access.team_manager_assignments')
		.dropConstraint('team_manager_assignments_member_season_unique')
		.execute()

	await sql`
		drop index if exists access.team_manager_assignments_league_season_id_index
	`.execute(db)

	await db.schema
		.alterTable('access.team_manager_assignments')
		.dropColumn('league_season_id')
		.execute()
}
