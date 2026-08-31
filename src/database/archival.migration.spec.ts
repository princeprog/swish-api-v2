import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('core archival migration', () => {
  const migrationSource = readFileSync(
    join(__dirname, 'migrations', '1788199103032_add_core_archival.ts'),
    'utf8',
  );

  it('adds an archive timestamp to every operational record', () => {
    for (const table of [
      'admin.organizations',
      'admin.league_seasons',
      'admin.divisions',
      'admin.teams',
      'admin.players',
      'admin.venues',
      'competition.games',
    ]) {
      expect(migrationSource).toContain(`'${table}'`);
    }
    expect(migrationSource).toContain("addColumn('archived_at', 'timestamptz')");
  });

  it('installs database-level delete guards and reverses them', () => {
    expect(migrationSource).toContain('admin.prevent_core_record_delete');
    expect(migrationSource).toContain('before delete on');
    expect(migrationSource).toContain('drop trigger if exists');
    expect(migrationSource).toContain(
      'drop function if exists admin.prevent_core_record_delete()',
    );
    expect(migrationSource).toContain("dropColumn('archived_at')");
  });
});
