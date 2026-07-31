import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema
		.alterTable('scoring.game_states')
		.addColumn('home_timeouts_used', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('away_timeouts_used', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.execute()

	await sql`
		alter table scoring.game_states
		add constraint game_states_timeouts_nonnegative_check
		check (
			home_timeouts_used >= 0
			and away_timeouts_used >= 0
		)
	`.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		alter table if exists scoring.game_states
		drop constraint if exists game_states_timeouts_nonnegative_check
	`.execute(db)

	await db.schema
		.alterTable('scoring.game_states')
		.dropColumn('home_timeouts_used')
		.dropColumn('away_timeouts_used')
		.execute()
}
