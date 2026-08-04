import { readFileSync } from 'fs';
import { join } from 'path';

describe('team manager assignment seasons migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1785808359651_add_team_manager_assignment_seasons.ts',
    ),
    'utf8',
  );

  it('stores the season for each team manager assignment', () => {
    expect(migrationSource).toContain("addColumn('league_season_id'");
    expect(migrationSource).toContain(
      'set league_season_id = divisions.league_season_id',
    );
    expect(migrationSource).toContain('alter column league_season_id set not null');
  });

  it('limits a manager to one assigned team per season', () => {
    expect(migrationSource).toContain(
      'team_manager_assignments_member_season_unique',
    );
    expect(migrationSource).toContain("'organization_member_id'");
    expect(migrationSource).toContain("'league_season_id'");
    expect(migrationSource).not.toContain(
      "addUniqueConstraint('team_manager_assignments_team_id_unique'",
    );
  });
});
