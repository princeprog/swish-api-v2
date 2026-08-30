import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('competition formats migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788120337397_add_competition_formats_and_pools.ts',
    ),
    'utf8',
  );

  it('adds season competition defaults and game rules', () => {
    expect(migrationSource).toContain("alterTable('admin.league_seasons')");
    expect(migrationSource).toContain("addColumn('schedule_slot_duration_minutes'");
    expect(migrationSource).toContain("addColumn('default_qualifying_format'");
    expect(migrationSource).toContain("addColumn('default_playoff_format'");
    expect(migrationSource).toContain("addColumn('personal_foul_limit'");
  });

  it('creates one editable competition format per division', () => {
    expect(migrationSource).toContain("createTable('competition.division_formats')");
    expect(migrationSource).toContain("references('admin.divisions.id')");
    expect(migrationSource).toContain('division_formats_values_check');
    expect(migrationSource).toContain("createIndex('division_formats_division_id_unique')");
  });

  it('creates ordered pools and unique team assignments', () => {
    expect(migrationSource).toContain("createTable('competition.pools')");
    expect(migrationSource).toContain("createTable('competition.pool_teams')");
    expect(migrationSource).toContain('pools_format_code_unique');
    expect(migrationSource).toContain('pool_teams_team_id_unique');
  });

  it('drops dependent records before reverting season columns', () => {
    expect(migrationSource).toContain("dropTable('competition.pool_teams')");
    expect(migrationSource).toContain("dropTable('competition.pools')");
    expect(migrationSource).toContain("dropTable('competition.division_formats')");
    expect(migrationSource).toContain("dropColumn('schedule_slot_duration_minutes')");
    expect(migrationSource).toContain("dropColumn('personal_foul_limit')");
  });
});
