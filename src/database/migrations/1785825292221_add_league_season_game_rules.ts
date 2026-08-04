import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable('admin.league_season_game_rules')
		.addColumn('league_season_id', 'uuid', (column) =>
			column
				.primaryKey()
				.references('admin.league_seasons.id')
				.onDelete('cascade'),
		)
		.addColumn('regulation_periods', 'integer', (column) =>
			column.notNull().defaultTo(4),
		)
		.addColumn('period_duration_ms', 'integer', (column) =>
			column.notNull().defaultTo(600000),
		)
		.addColumn('overtime_duration_ms', 'integer', (column) =>
			column.notNull().defaultTo(300000),
		)
		.addColumn('shot_clock_enabled', 'boolean', (column) =>
			column.notNull().defaultTo(true),
		)
		.addColumn('shot_clock_full_ms', 'integer', (column) =>
			column.notNull().defaultTo(24000),
		)
		.addColumn('shot_clock_short_ms', 'integer', (column) =>
			column.notNull().defaultTo(14000),
		)
		.addColumn('team_fouls_before_penalty', 'integer', (column) =>
			column.notNull().defaultTo(4),
		)
		.addColumn('timeouts_first_half', 'integer', (column) =>
			column.notNull().defaultTo(2),
		)
		.addColumn('timeouts_second_half', 'integer', (column) =>
			column.notNull().defaultTo(3),
		)
		.addColumn('timeouts_per_overtime', 'integer', (column) =>
			column.notNull().defaultTo(1),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addCheckConstraint(
			'season_game_rules_valid_values_check',
			sql`
				regulation_periods between 1 and 8
				and period_duration_ms between 60000 and 1800000
				and overtime_duration_ms between 60000 and 1800000
				and shot_clock_full_ms between 1000 and 99000
				and shot_clock_short_ms between 1000 and 99000
				and shot_clock_short_ms <= shot_clock_full_ms
				and team_fouls_before_penalty between 1 and 20
				and timeouts_first_half between 0 and 10
				and timeouts_second_half between 0 and 10
				and timeouts_per_overtime between 0 and 10
			`,
		)
		.execute()

	await sql`
		insert into admin.league_season_game_rules (
			league_season_id,
			regulation_periods,
			period_duration_ms,
			overtime_duration_ms,
			shot_clock_enabled,
			shot_clock_full_ms,
			shot_clock_short_ms,
			team_fouls_before_penalty,
			timeouts_first_half,
			timeouts_second_half,
			timeouts_per_overtime
		)
		select id, 4, 600000, 300000, true, 24000, 14000, 4, 2, 3, 1
		from admin.league_seasons
	`.execute(db)

	await db.schema
		.alterTable('scoring.game_states')
		.addColumn('shot_clock_enabled', 'boolean', (column) =>
			column.notNull().defaultTo(true),
		)
		.addColumn('team_fouls_before_penalty', 'integer', (column) =>
			column.notNull().defaultTo(4),
		)
		.addColumn('timeouts_first_half', 'integer', (column) =>
			column.notNull().defaultTo(2),
		)
		.addColumn('timeouts_second_half', 'integer', (column) =>
			column.notNull().defaultTo(3),
		)
		.addColumn('timeouts_per_overtime', 'integer', (column) =>
			column.notNull().defaultTo(1),
		)
		.execute()

	await sql`
		alter table scoring.game_states
		add constraint game_states_config_values_check
		check (
			team_fouls_before_penalty between 1 and 20
			and timeouts_first_half between 0 and 10
			and timeouts_second_half between 0 and 10
			and timeouts_per_overtime between 0 and 10
		)
	`.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		alter table if exists scoring.game_states
		drop constraint if exists game_states_config_values_check
	`.execute(db)

	await db.schema
		.alterTable('scoring.game_states')
		.dropColumn('timeouts_per_overtime')
		.dropColumn('timeouts_second_half')
		.dropColumn('timeouts_first_half')
		.dropColumn('team_fouls_before_penalty')
		.dropColumn('shot_clock_enabled')
		.execute()

	await db.schema
		.dropTable('admin.league_season_game_rules')
		.ifExists()
		.execute()
}
