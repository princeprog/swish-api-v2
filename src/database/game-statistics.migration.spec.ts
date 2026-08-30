import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('game statistics and awards migration', () => {
  const source = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788121804810_add_game_statistics_and_awards.ts',
    ),
    'utf8',
  );

  it('creates statistician assignment, roster snapshot, and control tables', () => {
    expect(source).toContain("createTable('access.game_statistician_assignments')");
    expect(source).toContain("createTable('scoring.game_roster_snapshots')");
    expect(source).toContain("createTable('scoring.game_roster_players')");
    expect(source).toContain("createTable('statistics.stat_control_sessions')");
    expect(source).toContain('game_statistician_assignments_game_id_unique');
  });

  it('creates append-only statistics, projections, reconciliation, and awards', () => {
    expect(source).toContain("createTable('statistics.game_stat_sheets')");
    expect(source).toContain("createTable('statistics.stat_events')");
    expect(source).toContain("createTable('statistics.player_box_scores')");
    expect(source).toContain("createTable('scoring.game_period_scores')");
    expect(source).toContain("createTable('scoring.player_foul_totals')");
    expect(source).toContain("createTable('statistics.game_awards')");
    expect(source).toContain('prevent_stat_event_mutation');
    expect(source).toContain('reverses_event_id');
    expect(source).toContain('override_reason');
  });

  it('drops every new table in dependency-safe reverse order', () => {
    expect(source).toContain("dropTable('statistics.game_awards')");
    expect(source).toContain("dropTable('statistics.stat_events')");
    expect(source).toContain("dropTable('scoring.game_roster_snapshots')");
    expect(source).toContain(
      "dropTable('access.game_statistician_assignments')",
    );
  });
});
