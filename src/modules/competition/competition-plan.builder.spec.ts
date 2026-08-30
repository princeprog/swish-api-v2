import { buildCompetitionPlan } from './competition-plan.builder';

const pools = [
  { code: 'A', id: 'pool-a', teamIds: ['A1', 'A2', 'A3', 'A4'] },
  { code: 'B', id: 'pool-b', teamIds: ['B1', 'B2', 'B3', 'B4'] },
];

describe('buildCompetitionPlan', () => {
  it('combines pool round robins with the configured crossover bracket', () => {
    const plan = buildCompetitionPlan({
      crossoverTemplate: [
        { awaySeed: 'B2', homeSeed: 'A1' },
        { awaySeed: 'A2', homeSeed: 'B1' },
      ],
      playoffFormat: 'single_elimination',
      pools,
      qualifiersPerPool: 2,
      qualifyingFormat: 'single_round_robin',
    });
    const qualifiers = plan.filter((matchup) => matchup.stage === 'qualifier');
    const playoffs = plan.filter((matchup) => matchup.stage === 'playoff');
    const semifinals = playoffs.filter((matchup) => matchup.roundNumber === 1);

    expect(qualifiers).toHaveLength(12);
    expect(playoffs).toHaveLength(3);
    expect(
      semifinals.map((matchup) => [
        matchup.homeSource.ref,
        matchup.awaySource.ref,
      ]),
    ).toEqual([
      ['A1', 'B2'],
      ['B1', 'A2'],
    ]);
    expect(
      semifinals.every(
        (matchup) =>
          matchup.homeSource.type === 'pool_seed' &&
          matchup.awaySource.type === 'pool_seed',
      ),
    ).toBe(true);
  });

  it('builds a direct double-elimination graph from an approved seed order', () => {
    const plan = buildCompetitionPlan({
      crossoverTemplate: [],
      directSeedTeamIds: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
      playoffFormat: 'double_elimination',
      pools: [],
      qualifiersPerPool: 1,
      qualifyingFormat: 'none',
    });

    expect(plan).toHaveLength(15);
    expect(plan.every((matchup) => matchup.stage === 'playoff')).toBe(true);
    expect(plan.some((matchup) => matchup.isResetFinal)).toBe(true);
  });

  it('rejects an unknown or duplicate crossover seed', () => {
    expect(() =>
      buildCompetitionPlan({
        crossoverTemplate: [
          { awaySeed: 'B2', homeSeed: 'A1' },
          { awaySeed: 'A1', homeSeed: 'C1' },
        ],
        playoffFormat: 'single_elimination',
        pools,
        qualifiersPerPool: 2,
        qualifyingFormat: 'single_round_robin',
      }),
    ).toThrow('Crossover seeds must be unique and refer to a qualifying pool.');
  });

  it('requires direct seed confirmation before generating direct elimination', () => {
    expect(() =>
      buildCompetitionPlan({
        crossoverTemplate: [],
        playoffFormat: 'single_elimination',
        pools: [],
        qualifiersPerPool: 1,
        qualifyingFormat: 'none',
      }),
    ).toThrow('Confirm the team seed order before generating this bracket.');
  });
});
