import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists competition.finalized_game_results`.execute(db)

	await sql`
		create view competition.finalized_game_results as
		select
			g.id,
			ls.organization_id,
			g.league_season_id,
			g.division_id,
			g.home_team_id,
			g.away_team_id,
			g.home_score,
			g.away_score,
			g.starts_at,
			g.finalized_at
		from competition.games g
		inner join admin.league_seasons ls
			on ls.id = g.league_season_id
		where g.status = 'final'
			and g.finalized_at is not null
			and g.home_score is not null
			and g.away_score is not null
	`.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists competition.finalized_game_results`.execute(db)

	await sql`
		create view competition.finalized_game_results as
		select
			g.id,
			ls.organization_id,
			g.league_season_id,
			g.division_id,
			g.home_team_id,
			g.away_team_id,
			g.home_score,
			g.away_score,
			g.finalized_at
		from competition.games g
		inner join admin.league_seasons ls
			on ls.id = g.league_season_id
		where g.status = 'final'
			and g.finalized_at is not null
			and g.home_score is not null
			and g.away_score is not null
	`.execute(db)
}
