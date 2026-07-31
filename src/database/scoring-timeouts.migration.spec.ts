import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('scoring timeouts migration', () => {
  const migrationSource = readFileSync(
    join(__dirname, 'migrations', '1785470144168_add_scoring_timeouts.ts'),
    'utf8',
  );

  it('adds home and away timeout usage counters to the scoring projection', () => {
    expect(migrationSource).toContain("alterTable('scoring.game_states')");
    expect(migrationSource).toContain("addColumn('home_timeouts_used'");
    expect(migrationSource).toContain("addColumn('away_timeouts_used'");
  });

  it('keeps timeout usage nonnegative and drops the fields on rollback', () => {
    expect(migrationSource).toContain('game_states_timeouts_nonnegative_check');
    expect(migrationSource).toContain('home_timeouts_used >= 0');
    expect(migrationSource).toContain('away_timeouts_used >= 0');
    expect(migrationSource).toContain("dropColumn('home_timeouts_used')");
    expect(migrationSource).toContain("dropColumn('away_timeouts_used')");
  });
});
