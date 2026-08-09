import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('invitation team assignments migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1786255889620_add_invitation_team_assignments.ts',
    ),
    'utf8',
  );

  it('creates normalized invitation team scope records', () => {
    expect(migrationSource).toContain(
      "createTable('access.invitation_team_assignments')",
    );
    expect(migrationSource).toContain("references('access.organization_invitations.id')");
    expect(migrationSource).toContain("references('admin.teams.id')");
    expect(migrationSource).toContain("references('admin.league_seasons.id')");
    expect(migrationSource).toContain(
      'invitation_team_assignments_invitation_season_unique',
    );
    expect(migrationSource).toContain(
      'invitation_team_assignments_team_id_index',
    );
  });

  it('drops the table in the reversible down migration', () => {
    const downSource = migrationSource.slice(
      migrationSource.indexOf('export async function down'),
    );

    expect(downSource).toContain(
      "dropTable('access.invitation_team_assignments')",
    );
  });
});
