import { sql, type Kysely } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists competition.games_matchup_id_unique`.execute(
    db,
  );
  await sql`
    create unique index games_matchup_id_unique
    on competition.games (matchup_id)
    where matchup_id is not null and archived_at is null
  `.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists competition.games_matchup_id_unique`.execute(
    db,
  );
  await sql`
    create unique index games_matchup_id_unique
    on competition.games (matchup_id)
    where matchup_id is not null
  `.execute(db);
}
