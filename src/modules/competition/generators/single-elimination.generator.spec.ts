import { generateSingleElimination } from './single-elimination.generator';

describe('generateSingleElimination', () => {
  it('places seeded teams into a standard bracket', () => {
    const matchups = generateSingleElimination(
      Array.from({ length: 8 }, (_, index) => `team-${index + 1}`),
    );
    const firstRound = matchups.filter((matchup) => matchup.roundNumber === 1);

    expect(firstRound.map((matchup) => [matchup.homeSource.ref, matchup.awaySource.ref])).toEqual([
      ['team-1', 'team-8'],
      ['team-4', 'team-5'],
      ['team-2', 'team-7'],
      ['team-3', 'team-6'],
    ]);
    expect(matchups).toHaveLength(7);
  });

  it('creates explicit byes and preserves a complete power-of-two graph', () => {
    const matchups = generateSingleElimination(
      Array.from({ length: 6 }, (_, index) => `team-${index + 1}`),
    );
    const firstRound = matchups.filter((matchup) => matchup.roundNumber === 1);

    expect(matchups).toHaveLength(7);
    expect(
      firstRound.filter(
        (matchup) =>
          matchup.homeSource.type === 'bye' ||
          matchup.awaySource.type === 'bye',
      ),
    ).toHaveLength(2);
    expect(matchups.filter((matchup) => matchup.bracketSide === 'finals')).toHaveLength(1);
  });

  it('links every non-final winner to exactly one later matchup slot', () => {
    const matchups = generateSingleElimination(['A', 'B', 'C', 'D']);
    const final = matchups.find((matchup) => matchup.bracketSide === 'finals');

    expect(final).toBeDefined();
    for (const matchup of matchups) {
      if (matchup.key === final?.key) {
        expect(matchup.winnerTo).toBeNull();
        continue;
      }

      const target = matchups.find(
        (candidate) => candidate.key === matchup.winnerTo?.matchupKey,
      );
      expect(target?.roundNumber).toBeGreaterThan(matchup.roundNumber);
      expect(
        matchup.winnerTo?.slot === 'home'
          ? target?.homeSource.ref
          : target?.awaySource.ref,
      ).toBe(matchup.key);
    }
  });

  it('rejects duplicate seeds and fields smaller than two teams', () => {
    expect(() => generateSingleElimination(['A'])).toThrow(
      'At least two teams are required',
    );
    expect(() => generateSingleElimination(['A', 'A'])).toThrow(
      'Each seed must identify a different team',
    );
  });
});
