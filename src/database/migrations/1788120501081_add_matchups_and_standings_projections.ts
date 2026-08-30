import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required because migrations are frozen schema snapshots.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('competition.matchups')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_format_id', 'uuid', (column) =>
      column
        .notNull()
        .references('competition.division_formats.id')
        .onDelete('cascade'),
    )
    .addColumn('pool_id', 'uuid', (column) =>
      column.references('competition.pools.id').onDelete('cascade'),
    )
    .addColumn('stage', 'varchar(24)', (column) => column.notNull())
    .addColumn('bracket_side', 'varchar(24)', (column) => column.notNull())
    .addColumn('round_number', 'integer', (column) => column.notNull())
    .addColumn('position', 'integer', (column) => column.notNull())
    .addColumn('label', 'varchar(120)')
    .addColumn('home_source_type', 'varchar(32)', (column) => column.notNull())
    .addColumn('home_source_ref', 'varchar(120)')
    .addColumn('away_source_type', 'varchar(32)', (column) => column.notNull())
    .addColumn('away_source_ref', 'varchar(120)')
    .addColumn('home_team_id', 'uuid', (column) =>
      column.references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('away_team_id', 'uuid', (column) =>
      column.references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('winner_team_id', 'uuid', (column) =>
      column.references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('loser_team_id', 'uuid', (column) =>
      column.references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('winner_to_matchup_id', 'uuid', (column) =>
      column.references('competition.matchups.id').onDelete('set null'),
    )
    .addColumn('winner_to_slot', 'varchar(8)')
    .addColumn('loser_to_matchup_id', 'uuid', (column) =>
      column.references('competition.matchups.id').onDelete('set null'),
    )
    .addColumn('loser_to_slot', 'varchar(8)')
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('is_reset_final', 'boolean', (column) =>
      column.notNull().defaultTo(false),
    )
    .addColumn('format_revision', 'integer', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'matchups_values_check',
      sql`
        stage in ('qualifier', 'playoff')
        and bracket_side in ('pool', 'winners', 'losers', 'finals')
        and round_number > 0
        and position > 0
        and home_source_type in ('team', 'pool_seed', 'matchup_winner', 'matchup_loser', 'bye')
        and away_source_type in ('team', 'pool_seed', 'matchup_winner', 'matchup_loser', 'bye')
        and status in ('pending', 'ready', 'scheduled', 'live', 'final', 'void')
        and format_revision > 0
        and (winner_to_slot is null or winner_to_slot in ('home', 'away'))
        and (loser_to_slot is null or loser_to_slot in ('home', 'away'))
        and (home_team_id is null or away_team_id is null or home_team_id <> away_team_id)
      `,
    )
    .execute();

  await db.schema
    .createIndex('matchups_format_revision_position_unique')
    .unique()
    .on('competition.matchups')
    .columns([
      'division_format_id',
      'format_revision',
      'stage',
      'bracket_side',
      'round_number',
      'position',
    ])
    .execute();

  await db.schema
    .createIndex('matchups_pool_id_index')
    .on('competition.matchups')
    .column('pool_id')
    .execute();

  await db.schema
    .createTable('competition.standings_projections')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_format_id', 'uuid', (column) =>
      column
        .notNull()
        .references('competition.division_formats.id')
        .onDelete('cascade'),
    )
    .addColumn('pool_id', 'uuid', (column) =>
      column.notNull().references('competition.pools.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('cascade'),
    )
    .addColumn('games_played', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('wins', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('losses', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('points_for', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('points_against', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('point_differential', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('win_percentage', sql`numeric(7,6)`, (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('rank', 'integer')
    .addColumn('qualification_status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('ranking_explanation', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('version', 'integer', (column) => column.notNull().defaultTo(1))
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'standings_projection_values_check',
      sql`
        games_played >= 0
        and wins >= 0
        and losses >= 0
        and points_for >= 0
        and points_against >= 0
        and win_percentage between 0 and 1
        and (rank is null or rank > 0)
        and qualification_status in ('pending', 'qualified', 'eliminated')
        and jsonb_typeof(ranking_explanation) = 'array'
        and version > 0
      `,
    )
    .execute();

  await db.schema
    .createIndex('standings_projection_team_unique')
    .unique()
    .on('competition.standings_projections')
    .columns(['division_format_id', 'pool_id', 'team_id'])
    .execute();

  await db.schema
    .createIndex('standings_projection_pool_rank_index')
    .on('competition.standings_projections')
    .columns(['pool_id', 'rank'])
    .execute();

  await db.schema
    .createTable('competition.tie_decisions')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_format_id', 'uuid', (column) =>
      column
        .notNull()
        .references('competition.division_formats.id')
        .onDelete('cascade'),
    )
    .addColumn('pool_id', 'uuid', (column) =>
      column.notNull().references('competition.pools.id').onDelete('cascade'),
    )
    .addColumn('tie_key', 'varchar(160)', (column) => column.notNull())
    .addColumn('team_ids', 'jsonb', (column) => column.notNull())
    .addColumn('ordered_team_ids', 'jsonb', (column) => column.notNull())
    .addColumn('reason', 'text', (column) => column.notNull())
    .addColumn('decided_by_member_id', 'uuid', (column) =>
      column
        .notNull()
        .references('admin.organization_members.id')
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'tie_decisions_values_check',
      sql`
        length(trim(reason)) > 0
        and jsonb_typeof(team_ids) = 'array'
        and jsonb_typeof(ordered_team_ids) = 'array'
      `,
    )
    .execute();

  await db.schema
    .createIndex('tie_decisions_key_unique')
    .unique()
    .on('competition.tie_decisions')
    .columns(['division_format_id', 'pool_id', 'tie_key'])
    .execute();

  await db.schema
    .alterTable('competition.games')
    .addColumn('matchup_id', 'uuid', (column) =>
      column.references('competition.matchups.id').onDelete('set null'),
    )
    .addColumn('competition_kind', 'varchar(24)', (column) =>
      column.notNull().defaultTo('stage'),
    )
    .execute();

  await sql`
    alter table competition.games
    add constraint games_competition_kind_check
    check (competition_kind in ('stage', 'playoff', 'exhibition'))
  `.execute(db);

  await db.schema
    .createIndex('games_matchup_id_unique')
    .unique()
    .on('competition.games')
    .column('matchup_id')
    .where('matchup_id', 'is not', null)
    .execute();

  await replaceScheduleGamesView(db, true);
}

// `any` is required because migrations are frozen schema snapshots.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop view if exists admin.schedule_games`.execute(db);

  await db.schema
    .alterTable('competition.games')
    .dropColumn('competition_kind')
    .dropColumn('matchup_id')
    .execute();

  await createScheduleGamesView(db, false);

  await db.schema
    .dropTable('competition.tie_decisions')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('competition.standings_projections')
    .ifExists()
    .execute();
  await db.schema.dropTable('competition.matchups').ifExists().execute();
}

async function replaceScheduleGamesView(
  db: Kysely<any>,
  includeCompetitionColumns: boolean,
) {
  await sql`drop view if exists admin.schedule_games`.execute(db);
  await createScheduleGamesView(db, includeCompetitionColumns);
}

async function createScheduleGamesView(
  db: Kysely<any>,
  includeCompetitionColumns: boolean,
) {
  const competitionColumns = includeCompetitionColumns
    ? sql`
        g.matchup_id,
        g.competition_kind,
      `
    : sql``;

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
      assignments.organization_member_id as scorekeeper_member_id,
      scorekeeper_users.name as scorekeeper_name,
      g.home_score,
      g.away_score,
      g.finalized_at,
      ${competitionColumns}
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
    left join access.game_scorekeeper_assignments assignments
      on assignments.game_id = g.id
    left join admin.organization_members scorekeeper_members
      on scorekeeper_members.id = assignments.organization_member_id
    left join auth.users scorekeeper_users
      on scorekeeper_users.id = scorekeeper_members.user_id
  `.execute(db);
}
