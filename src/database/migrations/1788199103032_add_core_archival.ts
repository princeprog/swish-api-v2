import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  for (const table of [
    'admin.organizations',
    'admin.league_seasons',
    'admin.divisions',
    'admin.teams',
    'admin.players',
    'admin.venues',
    'competition.games',
  ]) {
    await db.schema
      .alterTable(table)
      .addColumn('archived_at', 'timestamptz')
      .execute();
  }

  for (const [schema, table] of [
    ['admin', 'organizations'],
    ['admin', 'league_seasons'],
    ['admin', 'divisions'],
    ['admin', 'teams'],
    ['admin', 'players'],
    ['admin', 'venues'],
    ['competition', 'games'],
  ] as const) {
    await sql
      .raw(
        `create index ${table}_archived_at_index on ${schema}.${table} (archived_at)`,
      )
      .execute(db);
  }

  await sql`
		create or replace function admin.prevent_core_record_delete()
		returns trigger
		language plpgsql
		security invoker
		set search_path = pg_catalog, public
		as $$
		begin
			raise exception 'League records cannot be deleted. Archive the record instead.'
				using errcode = 'restrict_violation';
		end;
		$$;
	`.execute(db);

  for (const [table, trigger] of [
    ['admin.organizations', 'organizations_delete_guard'],
    ['admin.league_seasons', 'league_seasons_delete_guard'],
    ['admin.divisions', 'divisions_delete_guard'],
    ['admin.teams', 'teams_delete_guard'],
    ['admin.players', 'players_delete_guard'],
    ['admin.venues', 'venues_delete_guard'],
    ['competition.games', 'games_delete_guard'],
  ] as const) {
    await sql
      .raw(
        `create trigger ${trigger} before delete on ${table} for each row execute function admin.prevent_core_record_delete()`,
      )
      .execute(db);
  }
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  for (const [table, trigger] of [
    ['admin.organizations', 'organizations_delete_guard'],
    ['admin.league_seasons', 'league_seasons_delete_guard'],
    ['admin.divisions', 'divisions_delete_guard'],
    ['admin.teams', 'teams_delete_guard'],
    ['admin.players', 'players_delete_guard'],
    ['admin.venues', 'venues_delete_guard'],
    ['competition.games', 'games_delete_guard'],
  ] as const) {
    await sql.raw(`drop trigger if exists ${trigger} on ${table}`).execute(db);
  }

  await sql`drop function if exists admin.prevent_core_record_delete()`.execute(
    db,
  );

  for (const [schema, table] of [
    ['admin', 'organizations'],
    ['admin', 'league_seasons'],
    ['admin', 'divisions'],
    ['admin', 'teams'],
    ['admin', 'players'],
    ['admin', 'venues'],
    ['competition', 'games'],
  ] as const) {
    await sql
      .raw(`drop index if exists ${schema}.${table}_archived_at_index`)
      .execute(db);
  }

  for (const table of [
    'admin.organizations',
    'admin.league_seasons',
    'admin.divisions',
    'admin.teams',
    'admin.players',
    'admin.venues',
    'competition.games',
  ]) {
    await db.schema.alterTable(table).dropColumn('archived_at').execute();
  }
}
