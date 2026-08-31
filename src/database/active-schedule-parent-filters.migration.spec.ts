import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('active schedule parent filters migration contract', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src/database/migrations/1788201379864_active_schedule_parent_filters.ts',
    ),
    'utf8',
  );

  it('hides archived seasons, divisions, venues, and teams from operational schedule reads', () => {
    expect(source).toContain('ls.archived_at is null');
    expect(source).toContain('d.archived_at is null');
    expect(source).toContain('v.archived_at is null');
    expect(source).toContain('ht.archived_at is null');
    expect(source).toContain('at.archived_at is null');
  });

  it('restores the prior schedule view definition on rollback', () => {
    expect(source).toContain('createScheduleGamesView(db, false)');
    expect(source).toContain(
      'drop view if exists admin.schedule_games',
    );
  });
});
