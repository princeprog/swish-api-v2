import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists competition.matchups_format_revision_position_unique`.execute(
    db,
  );

  await db.schema
    .createIndex('matchups_qualifier_position_unique')
    .unique()
    .on('competition.matchups')
    .columns([
      'division_format_id',
      'format_revision',
      'pool_id',
      'round_number',
      'position',
    ])
    .where(sql<boolean>`stage = 'qualifier'`)
    .execute();

  await db.schema
    .createIndex('matchups_playoff_position_unique')
    .unique()
    .on('competition.matchups')
    .columns([
      'division_format_id',
      'format_revision',
      'bracket_side',
      'round_number',
      'position',
    ])
    .where(sql<boolean>`stage = 'playoff'`)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop index if exists competition.matchups_playoff_position_unique`.execute(
    db,
  );
  await sql`drop index if exists competition.matchups_qualifier_position_unique`.execute(
    db,
  );

  await db.schema
    .createIndex('matchups_format_revision_position_unique')
    .ifNotExists()
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
}
