import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists admin.schedule_games`.execute(db)

	await db.schema
		.alterTable('competition.games')
		.addColumn('home_score', 'integer')
		.execute()

	await db.schema
		.alterTable('competition.games')
		.addColumn('away_score', 'integer')
		.execute()

	await db.schema
		.alterTable('competition.games')
		.addColumn('finalized_at', 'timestamptz')
		.execute()

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
	`.execute(db)

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

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists competition.finalized_game_results`.execute(db)
	await sql`drop view if exists admin.schedule_games`.execute(db)

	await db.schema
		.alterTable('competition.games')
		.dropColumn('finalized_at')
		.execute()

	await db.schema
		.alterTable('competition.games')
		.dropColumn('away_score')
		.execute()

	await db.schema
		.alterTable('competition.games')
		.dropColumn('home_score')
		.execute()

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
	`.execute(db)
}
