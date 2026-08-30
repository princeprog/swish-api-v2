import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations must remain frozen in time.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('statistics').ifNotExists().execute();

  await db.schema
    .createTable('access.game_statistician_assignments')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('organization_member_id', 'uuid', (column) =>
      column.notNull().references('admin.organization_members.id').onDelete('cascade'),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .execute();
  await db.schema
    .createIndex('game_statistician_assignments_game_id_unique')
    .unique()
    .on('access.game_statistician_assignments')
    .column('game_id')
    .execute();

  await db.schema
    .createTable('scoring.game_roster_snapshots')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('source_roster_version_id', 'uuid', (column) =>
      column.references('admin.roster_versions.id').onDelete('set null'),
    )
    .addColumn('published_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('game_roster_snapshots_game_team_unique', [
      'game_id',
      'team_id',
    ])
    .execute();

  await db.schema
    .createTable('scoring.game_roster_players')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_roster_snapshot_id', 'uuid', (column) =>
      column
        .notNull()
        .references('scoring.game_roster_snapshots.id')
        .onDelete('cascade'),
    )
    .addColumn('source_player_id', 'uuid', (column) =>
      column.references('admin.players.id').onDelete('set null'),
    )
    .addColumn('name', 'varchar(160)', (column) => column.notNull())
    .addColumn('jersey_number', 'varchar(16)', (column) => column.notNull())
    .addColumn('position', 'varchar(40)')
    .addColumn('sort_order', 'integer', (column) => column.notNull())
    .addUniqueConstraint('game_roster_players_snapshot_jersey_unique', [
      'game_roster_snapshot_id',
      'jersey_number',
    ])
    .addCheckConstraint('game_roster_players_sort_order_check', sql`sort_order > 0`)
    .execute();

  await db.schema
    .createTable('scoring.game_period_scores')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('period_number', 'integer', (column) => column.notNull())
    .addColumn('overtime_number', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('home_score', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('away_score', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addUniqueConstraint('game_period_scores_game_period_unique', [
      'game_id',
      'period_number',
      'overtime_number',
    ])
    .addCheckConstraint(
      'game_period_scores_values_check',
      sql`period_number > 0 and overtime_number >= 0 and home_score >= 0 and away_score >= 0`,
    )
    .execute();

  await db.schema
    .createTable('scoring.player_foul_totals')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('game_roster_player_id', 'uuid', (column) =>
      column.notNull().references('scoring.game_roster_players.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('personal_fouls', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('fouled_out', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addUniqueConstraint('player_foul_totals_game_player_unique', [
      'game_id',
      'game_roster_player_id',
    ])
    .addCheckConstraint('player_foul_totals_nonnegative_check', sql`personal_fouls >= 0`)
    .execute();

  await db.schema
    .createTable('statistics.game_stat_sheets')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().unique().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('draft'),
    )
    .addColumn('version', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('home_player_points', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('away_player_points', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('reconciled_at', 'timestamptz')
    .addColumn('finalized_at', 'timestamptz')
    .addColumn('reopened_at', 'timestamptz')
    .addColumn('override_reason', 'text')
    .addColumn('override_by_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'game_stat_sheets_values_check',
      sql`
        status in ('draft', 'submitted', 'finalized', 'reopened')
        and version >= 0
        and home_player_points >= 0
        and away_player_points >= 0
        and (override_reason is null or length(trim(override_reason)) >= 10)
      `,
    )
    .execute();

  await db.schema
    .createTable('statistics.stat_control_sessions')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('organization_member_id', 'uuid', (column) =>
      column.notNull().references('admin.organization_members.id').onDelete('cascade'),
    )
    .addColumn('control_token_hash', 'varchar(128)', (column) => column.notNull())
    .addColumn('device_label', 'varchar(160)')
    .addColumn('claimed_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('last_heartbeat_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('released_at', 'timestamptz')
    .addColumn('release_reason', 'text')
    .addColumn('takeover_reason', 'text')
    .addColumn('taken_over_by_session_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .execute();
  await sql`
    alter table statistics.stat_control_sessions
    add constraint stat_control_sessions_takeover_fk
    foreign key (taken_over_by_session_id)
    references statistics.stat_control_sessions(id)
    on delete set null
  `.execute(db);
  await sql`
    create unique index stat_control_sessions_one_active_per_game
    on statistics.stat_control_sessions (game_id)
    where released_at is null
  `.execute(db);

  await db.schema
    .createTable('statistics.stat_events')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('stat_sheet_id', 'uuid', (column) =>
      column.notNull().references('statistics.game_stat_sheets.id').onDelete('cascade'),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('game_roster_player_id', 'uuid', (column) =>
      column.notNull().references('scoring.game_roster_players.id').onDelete('restrict'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('actor_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('type', 'varchar(24)', (column) => column.notNull())
    .addColumn('value', 'integer', (column) => column.notNull().defaultTo(1))
    .addColumn('sequence', 'integer', (column) => column.notNull())
    .addColumn('idempotency_key', 'varchar(128)', (column) => column.notNull())
    .addColumn('reverses_event_id', 'uuid')
    .addColumn('occurred_at_client', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('stat_events_game_sequence_unique', ['game_id', 'sequence'])
    .addUniqueConstraint('stat_events_game_idempotency_unique', [
      'game_id',
      'idempotency_key',
    ])
    .addCheckConstraint(
      'stat_events_values_check',
      sql`
        type in ('points', 'rebound', 'assist', 'steal', 'turnover')
        and value between 1 and 999
        and sequence > 0
      `,
    )
    .execute();
  await sql`
    alter table statistics.stat_events
    add constraint stat_events_reverses_event_fk
    foreign key (reverses_event_id)
    references statistics.stat_events(id)
    on delete restrict
  `.execute(db);

  await db.schema
    .createTable('statistics.player_box_scores')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('game_roster_player_id', 'uuid', (column) =>
      column.notNull().references('scoring.game_roster_players.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('points', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('rebounds', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('assists', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('steals', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('turnovers', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('player_box_scores_game_player_unique', [
      'game_id',
      'game_roster_player_id',
    ])
    .addCheckConstraint(
      'player_box_scores_nonnegative_check',
      sql`points >= 0 and rebounds >= 0 and assists >= 0 and steals >= 0 and turnovers >= 0`,
    )
    .execute();

  await db.schema
    .createTable('statistics.game_awards')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('game_id', 'uuid', (column) =>
      column.notNull().unique().references('competition.games.id').onDelete('cascade'),
    )
    .addColumn('suggested_player_id', 'uuid', (column) =>
      column.references('scoring.game_roster_players.id').onDelete('set null'),
    )
    .addColumn('selected_player_id', 'uuid', (column) =>
      column.references('scoring.game_roster_players.id').onDelete('set null'),
    )
    .addColumn('suggested_score', 'integer')
    .addColumn('confirmed_by_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('confirmation_reason', 'text')
    .addColumn('confirmed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .execute();

  await sql`
    create function statistics.prevent_stat_event_mutation()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'Statistic events are append-only';
    end;
    $$
  `.execute(db);
  await sql`
    create trigger prevent_stat_event_mutation
    before update or delete on statistics.stat_events
    for each row execute function statistics.prevent_stat_event_mutation()
  `.execute(db);
}

// `any` is required here since migrations must remain frozen in time.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop trigger if exists prevent_stat_event_mutation on statistics.stat_events`.execute(db);
  await sql`drop function if exists statistics.prevent_stat_event_mutation()`.execute(db);
  await db.schema.dropTable('statistics.game_awards').ifExists().execute();
  await db.schema.dropTable('statistics.player_box_scores').ifExists().execute();
  await sql`
    alter table if exists statistics.stat_events
    drop constraint if exists stat_events_reverses_event_fk
  `.execute(db);
  await db.schema.dropTable('statistics.stat_events').ifExists().execute();
  await sql`
    alter table if exists statistics.stat_control_sessions
    drop constraint if exists stat_control_sessions_takeover_fk
  `.execute(db);
  await db.schema.dropTable('statistics.stat_control_sessions').ifExists().execute();
  await db.schema.dropTable('statistics.game_stat_sheets').ifExists().execute();
  await db.schema.dropTable('scoring.player_foul_totals').ifExists().execute();
  await db.schema.dropTable('scoring.game_period_scores').ifExists().execute();
  await db.schema.dropTable('scoring.game_roster_players').ifExists().execute();
  await db.schema.dropTable('scoring.game_roster_snapshots').ifExists().execute();
  await db.schema
    .dropTable('access.game_statistician_assignments')
    .ifExists()
    .execute();
  await db.schema.dropSchema('statistics').ifExists().execute();
}
