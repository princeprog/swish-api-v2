import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('matchup graph migration', () => {
  const migrationSource = readFileSync(
    join(
      __dirname,
      'migrations',
      '1788120501081_add_matchups_and_standings_projections.ts',
    ),
    'utf8',
  );

  it('creates matchup slots and advancement edges', () => {
    expect(migrationSource).toContain("createTable('competition.matchups')");
    expect(migrationSource).toContain("addColumn('home_source_type'");
    expect(migrationSource).toContain("addColumn('winner_to_matchup_id'");
    expect(migrationSource).toContain("addColumn('loser_to_matchup_id'");
    expect(migrationSource).toContain('matchups_values_check');
  });

  it('links competition games to one matchup and labels exhibitions', () => {
    expect(migrationSource).toContain("alterTable('competition.games')");
    expect(migrationSource).toContain("addColumn('matchup_id'");
    expect(migrationSource).toContain("addColumn('competition_kind'");
    expect(migrationSource).toContain('games_matchup_id_unique');
  });

  it('persists explainable standings and audited tie decisions', () => {
    expect(migrationSource).toContain(
      "createTable('competition.standings_projections')",
    );
    expect(migrationSource).toContain("addColumn('ranking_explanation'");
    expect(migrationSource).toContain("createTable('competition.tie_decisions')");
    expect(migrationSource).toContain("references('admin.organization_members.id')");
  });

  it('reverts game links before dropping the graph', () => {
    expect(migrationSource).toContain("dropColumn('matchup_id')");
    expect(migrationSource).toContain(
      "dropTable('competition.standings_projections')",
    );
    expect(migrationSource).toContain("dropTable('competition.matchups')");
  });
});
