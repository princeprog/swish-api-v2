import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required because migrations are frozen schema snapshots.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('admin.league_seasons')
    .addColumn('schedule_slot_duration_minutes', 'integer', (column) =>
      column.notNull().defaultTo(90),
    )
    .addColumn('default_qualifying_format', 'varchar(40)', (column) =>
      column.notNull().defaultTo('single_round_robin'),
    )
    .addColumn('default_playoff_format', 'varchar(40)', (column) =>
      column.notNull().defaultTo('single_elimination'),
    )
    .addColumn('default_pool_count', 'integer', (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn('default_qualifiers_per_pool', 'integer', (column) =>
      column.notNull().defaultTo(4),
    )
    .addColumn('default_tiebreakers', 'jsonb', (column) =>
      column
        .notNull()
        .defaultTo(
          sql`'["win_percentage","head_to_head","point_differential","points_for","manual"]'::jsonb`,
        ),
    )
    .addColumn('default_crossover_template', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .execute();

  await sql`
    alter table admin.league_seasons
    add constraint league_seasons_competition_defaults_check
    check (
      schedule_slot_duration_minutes between 15 and 360
      and default_qualifying_format in ('none', 'single_round_robin', 'double_round_robin')
      and default_playoff_format in ('none', 'single_elimination', 'double_elimination')
      and default_pool_count between 1 and 16
      and default_qualifiers_per_pool between 1 and 64
      and jsonb_typeof(default_tiebreakers) = 'array'
      and jsonb_typeof(default_crossover_template) = 'array'
    )
  `.execute(db);

  await db.schema
    .alterTable('admin.league_season_game_rules')
    .addColumn('personal_foul_limit', 'integer', (column) =>
      column.notNull().defaultTo(5),
    )
    .execute();

  await sql`
    alter table admin.league_season_game_rules
    add constraint league_season_personal_foul_limit_check
    check (personal_foul_limit between 1 and 10)
  `.execute(db);

  await db.schema
    .createTable('competition.division_formats')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_id', 'uuid', (column) =>
      column.notNull().references('admin.divisions.id').onDelete('cascade'),
    )
    .addColumn('qualifying_format', 'varchar(40)', (column) =>
      column.notNull().defaultTo('single_round_robin'),
    )
    .addColumn('playoff_format', 'varchar(40)', (column) =>
      column.notNull().defaultTo('single_elimination'),
    )
    .addColumn('pool_count', 'integer', (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn('qualifiers_per_pool', 'integer', (column) =>
      column.notNull().defaultTo(4),
    )
    .addColumn('tiebreakers', 'jsonb', (column) =>
      column
        .notNull()
        .defaultTo(
          sql`'["win_percentage","head_to_head","point_differential","points_for","manual"]'::jsonb`,
        ),
    )
    .addColumn('crossover_template', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('draft'),
    )
    .addColumn('revision', 'integer', (column) =>
      column.notNull().defaultTo(1),
    )
    .addColumn('locked_at', 'timestamptz')
    .addColumn('generated_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'division_formats_values_check',
      sql`
        qualifying_format in ('none', 'single_round_robin', 'double_round_robin')
        and playoff_format in ('none', 'single_elimination', 'double_elimination')
        and pool_count between 1 and 16
        and qualifiers_per_pool between 1 and 64
        and status in ('draft', 'locked', 'completed')
        and revision > 0
        and jsonb_typeof(tiebreakers) = 'array'
        and jsonb_typeof(crossover_template) = 'array'
      `,
    )
    .execute();

  await db.schema
    .createIndex('division_formats_division_id_unique')
    .unique()
    .on('competition.division_formats')
    .column('division_id')
    .execute();

  await db.schema
    .createTable('competition.pools')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_format_id', 'uuid', (column) =>
      column
        .notNull()
        .references('competition.division_formats.id')
        .onDelete('cascade'),
    )
    .addColumn('name', 'varchar(120)', (column) => column.notNull())
    .addColumn('code', 'varchar(16)', (column) => column.notNull())
    .addColumn('sort_order', 'integer', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint('pools_sort_order_check', sql`sort_order > 0`)
    .execute();

  await db.schema
    .createIndex('pools_format_code_unique')
    .unique()
    .on('competition.pools')
    .columns(['division_format_id', 'code'])
    .execute();

  await db.schema
    .createIndex('pools_format_sort_order_unique')
    .unique()
    .on('competition.pools')
    .columns(['division_format_id', 'sort_order'])
    .execute();

  await db.schema
    .createTable('competition.pool_teams')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('pool_id', 'uuid', (column) =>
      column.notNull().references('competition.pools.id').onDelete('cascade'),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('cascade'),
    )
    .addColumn('seed', 'integer')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint('pool_teams_seed_check', sql`seed is null or seed > 0`)
    .execute();

  await db.schema
    .createIndex('pool_teams_team_id_unique')
    .unique()
    .on('competition.pool_teams')
    .column('team_id')
    .execute();

  await db.schema
    .createIndex('pool_teams_pool_seed_unique')
    .unique()
    .on('competition.pool_teams')
    .columns(['pool_id', 'seed'])
    .where('seed', 'is not', null)
    .execute();

  await sql`
    insert into competition.division_formats (
      division_id,
      qualifying_format,
      playoff_format,
      pool_count,
      qualifiers_per_pool,
      tiebreakers,
      crossover_template
    )
    select
      divisions.id,
      seasons.default_qualifying_format,
      seasons.default_playoff_format,
      seasons.default_pool_count,
      seasons.default_qualifiers_per_pool,
      seasons.default_tiebreakers,
      seasons.default_crossover_template
    from admin.divisions divisions
    inner join admin.league_seasons seasons
      on seasons.id = divisions.league_season_id
  `.execute(db);

  await sql`
    insert into competition.pools (division_format_id, name, code, sort_order)
    select id, 'Pool A', 'A', 1
    from competition.division_formats
  `.execute(db);
}

// `any` is required because migrations are frozen schema snapshots.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('competition.pool_teams').ifExists().execute();
  await db.schema.dropTable('competition.pools').ifExists().execute();
  await db.schema
    .dropTable('competition.division_formats')
    .ifExists()
    .execute();

  await db.schema
    .alterTable('admin.league_season_game_rules')
    .dropColumn('personal_foul_limit')
    .execute();

  await db.schema
    .alterTable('admin.league_seasons')
    .dropColumn('default_crossover_template')
    .dropColumn('default_tiebreakers')
    .dropColumn('default_qualifiers_per_pool')
    .dropColumn('default_pool_count')
    .dropColumn('default_playoff_format')
    .dropColumn('default_qualifying_format')
    .dropColumn('schedule_slot_duration_minutes')
    .execute();
}
