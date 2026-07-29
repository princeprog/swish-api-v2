import type { Kysely } from 'kysely'
import { sql } from 'kysely'

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.createSchema('scoring').ifNotExists().execute()

	await db.schema
		.createTable('scoring.game_states')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('game_id', 'uuid', (column) =>
			column
				.notNull()
				.unique()
				.references('competition.games.id')
				.onDelete('cascade'),
		)
		.addColumn('phase', 'varchar(40)', (column) =>
			column.notNull().defaultTo('pregame'),
		)
		.addColumn('regulation_periods', 'integer', (column) =>
			column.notNull().defaultTo(4),
		)
		.addColumn('current_period_number', 'integer', (column) =>
			column.notNull().defaultTo(1),
		)
		.addColumn('overtime_number', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('home_score', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('away_score', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('home_team_fouls', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('away_team_fouls', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('period_duration_ms', 'integer', (column) =>
			column.notNull().defaultTo(600000),
		)
		.addColumn('overtime_duration_ms', 'integer', (column) =>
			column.notNull().defaultTo(300000),
		)
		.addColumn('game_clock_remaining_ms', 'integer', (column) =>
			column.notNull().defaultTo(600000),
		)
		.addColumn('game_clock_running', 'boolean', (column) =>
			column.notNull().defaultTo(false),
		)
		.addColumn('game_clock_started_at', 'timestamptz')
		.addColumn('shot_clock_full_ms', 'integer', (column) =>
			column.notNull().defaultTo(24000),
		)
		.addColumn('shot_clock_short_ms', 'integer', (column) =>
			column.notNull().defaultTo(14000),
		)
		.addColumn('shot_clock_remaining_ms', 'integer', (column) =>
			column.notNull().defaultTo(24000),
		)
		.addColumn('shot_clock_running', 'boolean', (column) =>
			column.notNull().defaultTo(false),
		)
		.addColumn('shot_clock_started_at', 'timestamptz')
		.addColumn('latest_reversible_event_id', 'uuid')
		.addColumn('version', 'integer', (column) => column.notNull().defaultTo(0))
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addCheckConstraint(
			'game_states_nonnegative_values_check',
			sql`
				regulation_periods > 0
				and current_period_number > 0
				and overtime_number >= 0
				and home_score >= 0
				and away_score >= 0
				and home_team_fouls >= 0
				and away_team_fouls >= 0
				and period_duration_ms > 0
				and overtime_duration_ms > 0
				and game_clock_remaining_ms >= 0
				and shot_clock_full_ms > 0
				and shot_clock_short_ms > 0
				and shot_clock_short_ms <= shot_clock_full_ms
				and shot_clock_remaining_ms >= 0
				and version >= 0
			`,
		)
		.execute()

	await db.schema
		.createIndex('game_states_game_id_index')
		.on('scoring.game_states')
		.column('game_id')
		.execute()

	await db.schema
		.createTable('scoring.game_events')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('game_id', 'uuid', (column) =>
			column
				.notNull()
				.references('competition.games.id')
				.onDelete('cascade'),
		)
		.addColumn('actor_member_id', 'uuid', (column) =>
			column.references('admin.organization_members.id').onDelete('set null'),
		)
		.addColumn('sequence', 'integer', (column) => column.notNull())
		.addColumn('type', 'varchar(80)', (column) => column.notNull())
		.addColumn('period_number', 'integer', (column) => column.notNull())
		.addColumn('overtime_number', 'integer', (column) =>
			column.notNull().defaultTo(0),
		)
		.addColumn('game_clock_remaining_ms', 'integer', (column) =>
			column.notNull(),
		)
		.addColumn('shot_clock_remaining_ms', 'integer', (column) =>
			column.notNull(),
		)
		.addColumn('payload', 'jsonb', (column) =>
			column.notNull().defaultTo(sql`'{}'::jsonb`),
		)
		.addColumn('reverses_event_id', 'uuid')
		.addColumn('idempotency_key', 'varchar(120)', (column) =>
			column.notNull(),
		)
		.addColumn('occurred_at_client', 'timestamptz')
		.addColumn('occurred_at_server', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('game_events_game_sequence_unique', [
			'game_id',
			'sequence',
		])
		.addUniqueConstraint('game_events_game_idempotency_unique', [
			'game_id',
			'idempotency_key',
		])
		.addCheckConstraint(
			'game_events_nonnegative_clock_check',
			sql`
				period_number > 0
				and overtime_number >= 0
				and game_clock_remaining_ms >= 0
				and shot_clock_remaining_ms >= 0
			`,
		)
		.execute()

	await db.schema
		.createIndex('game_events_game_id_sequence_index')
		.on('scoring.game_events')
		.columns(['game_id', 'sequence'])
		.execute()

	await db.schema
		.createIndex('game_events_actor_member_id_index')
		.on('scoring.game_events')
		.column('actor_member_id')
		.execute()

	await sql`
		alter table scoring.game_events
		add constraint game_events_reverses_event_id_fkey
		foreign key (reverses_event_id)
		references scoring.game_events(id)
		on delete restrict
	`.execute(db)

	await sql`
		alter table scoring.game_states
		add constraint game_states_latest_reversible_event_id_fkey
		foreign key (latest_reversible_event_id)
		references scoring.game_events(id)
		on delete set null
	`.execute(db)

	await db.schema
		.createTable('scoring.game_control_sessions')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('game_id', 'uuid', (column) =>
			column
				.notNull()
				.references('competition.games.id')
				.onDelete('cascade'),
		)
		.addColumn('organization_member_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.organization_members.id')
				.onDelete('restrict'),
		)
		.addColumn('control_token_hash', 'varchar(128)', (column) =>
			column.notNull(),
		)
		.addColumn('device_label', 'varchar(120)')
		.addColumn('claimed_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('last_heartbeat_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('expires_at', 'timestamptz', (column) => column.notNull())
		.addColumn('released_at', 'timestamptz')
		.addColumn('release_reason', 'varchar(120)')
		.addColumn('taken_over_by_session_id', 'uuid')
		.addColumn('takeover_reason', 'text')
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.execute()

	await db.schema
		.createIndex('game_control_sessions_game_id_index')
		.on('scoring.game_control_sessions')
		.column('game_id')
		.execute()

	await db.schema
		.createIndex('game_control_sessions_member_id_index')
		.on('scoring.game_control_sessions')
		.column('organization_member_id')
		.execute()

	await sql`
		create unique index game_control_sessions_one_active_per_game
		on scoring.game_control_sessions (game_id)
		where released_at is null
	`.execute(db)

	await sql`
		alter table scoring.game_control_sessions
		add constraint game_control_sessions_taken_over_by_session_id_fkey
		foreign key (taken_over_by_session_id)
		references scoring.game_control_sessions(id)
		on delete set null
	`.execute(db)

	await sql`
		create or replace function scoring.prevent_game_event_mutation()
		returns trigger as $$
		begin
			raise exception 'Cannot update or delete scoring events';
		end;
		$$ language plpgsql
	`.execute(db)

	await sql`
		create trigger prevent_game_event_mutation_trigger
		before update or delete on scoring.game_events
		for each row execute function scoring.prevent_game_event_mutation()
	`.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
	await sql`
		drop trigger if exists prevent_game_event_mutation_trigger
		on scoring.game_events
	`.execute(db)
	await sql`drop function if exists scoring.prevent_game_event_mutation`.execute(db)
	await sql`
		alter table if exists scoring.game_states
		drop constraint if exists game_states_latest_reversible_event_id_fkey
	`.execute(db)
	await sql`
		alter table if exists scoring.game_events
		drop constraint if exists game_events_reverses_event_id_fkey
	`.execute(db)
	await sql`
		alter table if exists scoring.game_control_sessions
		drop constraint if exists game_control_sessions_taken_over_by_session_id_fkey
	`.execute(db)
	await db.schema
		.dropTable('scoring.game_control_sessions')
		.ifExists()
		.execute()
	await db.schema.dropTable('scoring.game_events').ifExists().execute()
	await db.schema.dropTable('scoring.game_states').ifExists().execute()
	await db.schema.dropSchema('scoring').ifExists().execute()
}
