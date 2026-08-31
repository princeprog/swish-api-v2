import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('archived public history migration contract', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src/database/migrations/1788200750936_add_archived_public_history.ts',
    ),
    'utf8',
  );

  it('hides archived organizations, seasons, divisions, and teams from public shells', () => {
    expect(source).toContain('o.archived_at is null');
    expect(source).toContain('ls.archived_at is null');
    expect(source).toContain('d.archived_at is null');
    expect(source).toContain('t.archived_at is null');
  });

  it('restores the pre-archive view definitions on rollback', () => {
    expect(source).toContain('recreatePublicViews(db, true)');
    expect(source).toContain('recreatePublicViews(db, false)');
  });
});
