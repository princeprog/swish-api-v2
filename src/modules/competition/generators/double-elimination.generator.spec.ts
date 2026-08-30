import { generateDoubleElimination } from './double-elimination.generator';

describe('generateDoubleElimination', () => {
  it('builds the complete eight-team winners, losers, and finals graph', () => {
    const matchups = generateDoubleElimination(
      Array.from({ length: 8 }, (_, index) => `team-${index + 1}`),
    );

    expect(matchups).toHaveLength(15);
    expect(
      matchups.filter((matchup) => matchup.bracketSide === 'winners'),
    ).toHaveLength(7);
    expect(
      matchups.filter((matchup) => matchup.bracketSide === 'losers'),
    ).toHaveLength(6);
    expect(
      matchups.filter((matchup) => matchup.bracketSide === 'finals'),
    ).toHaveLength(2);
  });

  it('routes every winners-bracket loser into exactly one losers-bracket slot', () => {
    const matchups = generateDoubleElimination(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const winners = matchups.filter(
      (matchup) => matchup.bracketSide === 'winners',
    );

    for (const matchup of winners) {
      expect(matchup.loserTo).not.toBeNull();
      const loserSources = matchups.flatMap((candidate) => [
        candidate.homeSource,
        candidate.awaySource,
      ]).filter(
        (source) =>
          source.type === 'matchup_loser' && source.ref === matchup.key,
      );

      expect(loserSources).toHaveLength(1);
      expect(
        loserSources[0] === undefined
          ? undefined
          : matchup.loserTo?.matchupKey,
      ).toBe(
        matchups.find((candidate) =>
          [candidate.homeSource, candidate.awaySource].includes(
            loserSources[0],
          ),
        )?.key,
      );
    }
  });

  it('only eliminates teams through a losers-bracket loss', () => {
    const matchups = generateDoubleElimination(['A', 'B', 'C', 'D']);
    const loserBracket = matchups.filter(
      (matchup) => matchup.bracketSide === 'losers',
    );

    for (const matchup of loserBracket) {
      expect(matchup.loserTo).toBeNull();
      for (const source of [matchup.homeSource, matchup.awaySource]) {
        expect(['matchup_loser', 'matchup_winner']).toContain(source.type);
      }
    }
    expect(
      matchups
        .filter((matchup) => matchup.bracketSide === 'winners')
        .every((matchup) => matchup.loserTo !== null),
    ).toBe(true);
  });

  it('simulates a reset-final tournament with one champion and two losses per eliminated team', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const matchups = generateDoubleElimination(teams);
    const results = new Map<string, { loser: string | null; winner: string }>();
    const losses = new Map(teams.map((teamId) => [teamId, 0]));

    const resolve = (source: (typeof matchups)[number]['homeSource']) => {
      if (source.type === 'team') return source.ref;
      if (source.type === 'bye' || source.ref === null) return null;
      const result = results.get(source.ref);
      return source.type === 'matchup_winner'
        ? result?.winner ?? null
        : result?.loser ?? null;
    };

    for (const matchup of matchups) {
      const home = resolve(matchup.homeSource);
      const away = resolve(matchup.awaySource);
      expect(home).not.toBeNull();
      expect(away).not.toBeNull();

      const winner =
        matchup.key === 'GF-1'
          ? (away as string)
          : matchup.key === 'GF-RESET'
            ? (home as string)
            : (home as string);
      const loser = winner === home ? (away as string) : (home as string);
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
      results.set(matchup.key, { loser, winner });

      if (matchup.bracketSide === 'losers' || matchup.key === 'GF-RESET') {
        expect(losses.get(loser)).toBe(2);
      }
    }

    const champion = results.get('GF-RESET')?.winner;
    expect(champion).toBeDefined();
    expect(losses.get(champion as string)).toBe(1);
    expect(
      teams.filter((teamId) => teamId !== champion).every(
        (teamId) => losses.get(teamId) === 2,
      ),
    ).toBe(true);
  });

  it('adds a conditional reset final using both grand-final participants', () => {
    const matchups = generateDoubleElimination(['A', 'B', 'C', 'D']);
    const grandFinal = matchups.find((matchup) => matchup.key === 'GF-1');
    const resetFinal = matchups.find((matchup) => matchup.key === 'GF-RESET');

    expect(grandFinal?.winnerTo).toEqual({
      matchupKey: 'GF-RESET',
      slot: 'home',
    });
    expect(grandFinal?.loserTo).toEqual({
      matchupKey: 'GF-RESET',
      slot: 'away',
    });
    expect(resetFinal).toMatchObject({
      awaySource: { ref: 'GF-1', type: 'matchup_loser' },
      homeSource: { ref: 'GF-1', type: 'matchup_winner' },
      isResetFinal: true,
      winnerTo: null,
    });
  });

  it('keeps a power-of-two graph when the seeded field contains byes', () => {
    const matchups = generateDoubleElimination(
      Array.from({ length: 6 }, (_, index) => `team-${index + 1}`),
    );

    expect(matchups).toHaveLength(15);
    expect(
      matchups.filter(
        (matchup) =>
          matchup.homeSource.type === 'bye' ||
          matchup.awaySource.type === 'bye',
      ),
    ).toHaveLength(2);
  });
});
