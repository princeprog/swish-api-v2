import { sql, type Kysely } from 'kysely';

const correctDefault =
  '["win_percentage","head_to_head","point_differential","points_for","manual_decision"]';
const legacyDefault =
  '["win_percentage","head_to_head","point_differential","points_for","manual"]';

async function replaceRule(
  db: Kysely<any>,
  table: string,
  column: string,
  from: string,
  to: string,
) {
  await sql.raw(`
    update ${table}
    set ${column} = (
      select jsonb_agg(
        case when value = '${JSON.stringify(from)}'::jsonb
          then '${JSON.stringify(to)}'::jsonb
          else value
        end
        order by ordinality
      )
      from jsonb_array_elements(${column}) with ordinality
    )
    where ${column} @> '${JSON.stringify([from])}'::jsonb
  `).execute(db);
}

export async function up(db: Kysely<any>): Promise<void> {
  await sql.raw(`
    alter table admin.league_seasons
    alter column default_tiebreakers set default '${correctDefault}'::jsonb
  `).execute(db);
  await sql.raw(`
    alter table competition.division_formats
    alter column tiebreakers set default '${correctDefault}'::jsonb
  `).execute(db);
  await replaceRule(
    db,
    'admin.league_seasons',
    'default_tiebreakers',
    'manual',
    'manual_decision',
  );
  await replaceRule(
    db,
    'competition.division_formats',
    'tiebreakers',
    'manual',
    'manual_decision',
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await replaceRule(
    db,
    'admin.league_seasons',
    'default_tiebreakers',
    'manual_decision',
    'manual',
  );
  await replaceRule(
    db,
    'competition.division_formats',
    'tiebreakers',
    'manual_decision',
    'manual',
  );
  await sql.raw(`
    alter table admin.league_seasons
    alter column default_tiebreakers set default '${legacyDefault}'::jsonb
  `).execute(db);
  await sql.raw(`
    alter table competition.division_formats
    alter column tiebreakers set default '${legacyDefault}'::jsonb
  `).execute(db);
}
