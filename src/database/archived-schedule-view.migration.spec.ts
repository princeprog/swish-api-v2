import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('archived schedule view migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788199670544_add_archived_game_schedule_view.ts',
    ),
    'utf8',
  );

  it('publishes the game archive state to schedule queries', () => {
    expect(migrationSource).toContain('g.archived_at');
    expect(migrationSource).toContain('create view admin.schedule_games');
  });

  it('recreates the previous view shape on rollback', () => {
    expect(migrationSource).toContain('createScheduleGamesView(db, false)');
    expect(migrationSource).toContain(
      'drop view if exists admin.schedule_games',
    );
  });
});
