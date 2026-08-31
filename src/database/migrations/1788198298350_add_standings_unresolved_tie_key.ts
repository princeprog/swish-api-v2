import type { Kysely } from 'kysely';

// `any` is required because migrations are frozen schema snapshots.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('competition.standings_projections')
    .addColumn('unresolved_tie_key', 'varchar(160)')
    .execute();
}

// `any` is required because migrations are frozen schema snapshots.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('competition.standings_projections')
    .dropColumn('unresolved_tie_key')
    .execute();
}
