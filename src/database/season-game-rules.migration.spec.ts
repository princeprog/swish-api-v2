import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('season game rules migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1785825292221_add_league_season_game_rules.ts',
    ),
    'utf8',
  );

  it('creates one rules record per season and backfills approved defaults', () => {
    expect(migrationSource).toContain(
      "createTable('admin.league_season_game_rules')",
    );
    expect(migrationSource).toContain("addColumn('league_season_id'");
    expect(migrationSource).toContain("references('admin.league_seasons.id')");
    expect(migrationSource).toContain('insert into admin.league_season_game_rules');
    expect(migrationSource).toContain('select id, 4, 600000, 300000, true');
  });

  it('adds immutable rule snapshot fields to scoring game states', () => {
    expect(migrationSource).toContain("alterTable('scoring.game_states')");
    expect(migrationSource).toContain("addColumn('shot_clock_enabled'");
    expect(migrationSource).toContain(
      "addColumn('team_fouls_before_penalty'",
    );
    expect(migrationSource).toContain("addColumn('timeouts_first_half'");
    expect(migrationSource).toContain("addColumn('timeouts_second_half'");
    expect(migrationSource).toContain("addColumn('timeouts_per_overtime'");
  });

  it('constrains rule values and reverses every schema change', () => {
    expect(migrationSource).toContain('season_game_rules_valid_values_check');
    expect(migrationSource).toContain(
      'shot_clock_short_ms <= shot_clock_full_ms',
    );
    expect(migrationSource).toContain(
      "dropTable('admin.league_season_game_rules')",
    );
    expect(migrationSource).toContain("dropColumn('shot_clock_enabled')");
    expect(migrationSource).toContain(
      "dropColumn('team_fouls_before_penalty')",
    );
  });
});
