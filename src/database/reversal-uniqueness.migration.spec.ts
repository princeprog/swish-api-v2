import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reversal uniqueness migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788202000000_add_reversal_uniqueness.ts',
    ),
    'utf8',
  );

  it('prevents more than one score or statistic reversal for the same event', () => {
    expect(migrationSource).toContain(
      'scoring_game_events_one_reversal_per_event',
    );
    expect(migrationSource).toContain(
      'statistics_stat_events_one_reversal_per_event',
    );
    expect(migrationSource).toContain(
      'where reverses_event_id is not null',
    );
  });

  it('drops both schema-qualified indexes on rollback', () => {
    expect(migrationSource).toContain(
      'drop index if exists scoring.scoring_game_events_one_reversal_per_event',
    );
    expect(migrationSource).toContain(
      'drop index if exists statistics.statistics_stat_events_one_reversal_per_event',
    );
  });
});
