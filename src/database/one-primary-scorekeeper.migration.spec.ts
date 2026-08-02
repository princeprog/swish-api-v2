import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('one primary scorekeeper migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1785635466142_one_primary_scorekeeper_per_game.ts',
    ),
    'utf8',
  );

  it('retains only one scorekeeper assignment per game before adding the unique index', () => {
    expect(migrationSource).toContain(
      'delete from access.game_scorekeeper_assignments assignments',
    );
    expect(migrationSource).toContain('assignments.created_at >');
    expect(migrationSource).toContain(
      'game_scorekeeper_assignments_game_id_unique',
    );
    expect(migrationSource).toContain('.unique()');
  });

  it('adds scorekeeper fields to the schedule game view and restores the old index on rollback', () => {
    expect(migrationSource).toContain(
      'assignments.organization_member_id as scorekeeper_member_id',
    );
    expect(migrationSource).toContain(
      'scorekeeper_users.name as scorekeeper_name',
    );
    expect(migrationSource).toContain(
      "dropIndex('game_scorekeeper_assignments_game_id_unique')",
    );
    expect(migrationSource).toContain(
      "createIndex('game_scorekeeper_assignments_game_id_index')",
    );
  });
});
