import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await sql`
		delete from access.game_scorekeeper_assignments assignments
		using access.game_scorekeeper_assignments duplicate_assignments
		where assignments.game_id = duplicate_assignments.game_id
			and (
				assignments.created_at > duplicate_assignments.created_at
				or (
					assignments.created_at = duplicate_assignments.created_at
					and assignments.id::text > duplicate_assignments.id::text
				)
			)
	`.execute(db)

	await sql`
		drop index if exists access.game_scorekeeper_assignments_game_id_index
	`.execute(db)

	await db.schema
		.createIndex('game_scorekeeper_assignments_game_id_unique')
		.on('access.game_scorekeeper_assignments')
		.column('game_id')
		.unique()
		.execute()

	await sql`drop view if exists admin.schedule_games`.execute(db)

	await createScheduleGamesView(db, true)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists admin.schedule_games`.execute(db)

	await createScheduleGamesView(db, false)

	await sql`
		drop index if exists access.game_scorekeeper_assignments_game_id_unique
	`.execute(db)

	await db.schema
		.createIndex('game_scorekeeper_assignments_game_id_index')
		.on('access.game_scorekeeper_assignments')
		.column('game_id')
		.execute()
}

async function createScheduleGamesView(
	db: Kysely<any>,
	includeScorekeeper: boolean,
) {
	const scorekeeperColumns = includeScorekeeper
		? sql`
			assignments.organization_member_id as scorekeeper_member_id,
			scorekeeper_users.name as scorekeeper_name,
		`
		: sql``

	const scorekeeperJoins = includeScorekeeper
		? sql`
			left join access.game_scorekeeper_assignments assignments
				on assignments.game_id = g.id
			left join admin.organization_members scorekeeper_members
				on scorekeeper_members.id = assignments.organization_member_id
			left join auth.users scorekeeper_users
				on scorekeeper_users.id = scorekeeper_members.user_id
		`
		: sql``

	await sql`
		create view admin.schedule_games as
		select
			g.id,
			ls.organization_id,
			g.league_season_id,
			ls.name as league_season_name,
			ls.slug as league_season_slug,
			g.division_id,
			d.name as division_name,
			d.slug as division_slug,
			g.venue_id,
			v.name as venue_name,
			v.slug as venue_slug,
			g.home_team_id,
			ht.name as home_team_name,
			ht.slug as home_team_slug,
			ht.color as home_team_color,
			g.away_team_id,
			at.name as away_team_name,
			at.slug as away_team_slug,
			at.color as away_team_color,
			${scorekeeperColumns}
			g.home_score,
			g.away_score,
			g.finalized_at,
			g.starts_at,
			g.status,
			g.published_at,
			g.created_at,
			g.updated_at
		from competition.games g
		inner join admin.league_seasons ls
			on ls.id = g.league_season_id
		inner join admin.divisions d
			on d.id = g.division_id
		inner join admin.venues v
			on v.id = g.venue_id
		inner join admin.teams ht
			on ht.id = g.home_team_id
		inner join admin.teams at
			on at.id = g.away_team_id
		${scorekeeperJoins}
	`.execute(db)
}
