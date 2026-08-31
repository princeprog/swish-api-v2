import { sql, type Kysely } from 'kysely';

// `any` is required because migrations are frozen schema snapshots.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    create unique index scoring_game_events_one_reversal_per_event
    on scoring.game_events (game_id, reverses_event_id)
    where reverses_event_id is not null
  `.execute(db);

  await sql`
    create unique index statistics_stat_events_one_reversal_per_event
    on statistics.stat_events (game_id, reverses_event_id)
    where reverses_event_id is not null
  `.execute(db);
}

// `any` is required because migrations are frozen schema snapshots.
export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    drop index if exists scoring.scoring_game_events_one_reversal_per_event
  `.execute(db);
  await sql`
    drop index if exists statistics.statistics_stat_events_one_reversal_per_event
  `.execute(db);
}
