import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('archived matchup reuse migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788199889605_allow_archived_matchup_reuse.ts',
    ),
    'utf8',
  );

  it('keeps only active generated games in the matchup uniqueness index', () => {
    expect(migrationSource).toContain(
      'where matchup_id is not null and archived_at is null',
    );
  });

  it('restores the original uniqueness rule on rollback', () => {
    expect(migrationSource).toContain(
      'where matchup_id is not null\n  `.execute(db);',
    );
  });
});
