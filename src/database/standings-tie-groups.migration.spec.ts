import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('standings tie groups migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788198298350_add_standings_unresolved_tie_key.ts',
    ),
    'utf8',
  );

  it('persists the exact unresolved tie group on each standings row', () => {
    expect(migrationSource).toContain(
      "alterTable('competition.standings_projections')",
    );
    expect(migrationSource).toContain(
      "addColumn('unresolved_tie_key', 'varchar(160)')",
    );
  });

  it('reverses the tie-group column', () => {
    expect(migrationSource).toContain("dropColumn('unresolved_tie_key')");
  });
});
