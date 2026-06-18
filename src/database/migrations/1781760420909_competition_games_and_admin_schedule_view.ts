import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('competition').ifNotExists().execute();

  await db.schema
    .createTable('competition.games')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('league_season_id', 'uuid', (column) =>
      column
        .notNull()
        .references('admin.league_seasons.id')
        .onDelete('cascade'),
    )
    .addColumn('division_id', 'uuid', (column) =>
      column.notNull().references('admin.divisions.id').onDelete('cascade'),
    )
    .addColumn('venue_id', 'uuid', (column) =>
      column.notNull().references('admin.venues.id').onDelete('restrict'),
    )
    .addColumn('home_team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('away_team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('restrict'),
    )
    .addColumn('starts_at', 'timestamptz', (column) => column.notNull())
    .addColumn('status', 'varchar(40)', (column) =>
      column.notNull().defaultTo('draft'),
    )
    .addColumn('published_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'games_home_away_team_distinct_check',
      sql`home_team_id <> away_team_id`,
    )
    .execute();

  await db.schema
    .createIndex('games_league_season_id_index')
    .on('competition.games')
    .column('league_season_id')
    .execute();

  await db.schema
    .createIndex('games_division_id_index')
    .on('competition.games')
    .column('division_id')
    .execute();

  await db.schema
    .createIndex('games_venue_id_index')
    .on('competition.games')
    .column('venue_id')
    .execute();

  await db.schema
    .createIndex('games_home_team_id_index')
    .on('competition.games')
    .column('home_team_id')
    .execute();

  await db.schema
    .createIndex('games_away_team_id_index')
    .on('competition.games')
    .column('away_team_id')
    .execute();

  await db.schema
    .createIndex('games_starts_at_index')
    .on('competition.games')
    .column('starts_at')
    .execute();

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
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop view if exists admin.schedule_games`.execute(db);
  await db.schema.dropTable('competition.games').ifExists().execute();
  await db.schema.dropSchema('competition').ifExists().execute();
}
