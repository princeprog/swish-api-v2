import { generateRoundRobin } from './round-robin.generator';

const teamIds = ['A', 'B', 'C', 'D'];

function pairKey(homeTeamId: string, awayTeamId: string) {
  return [homeTeamId, awayTeamId].sort().join(':');
}

describe('generateRoundRobin', () => {
  it('creates every pairing once with one game per team in each round', () => {
    const fixtures = generateRoundRobin(teamIds, false);

    expect(fixtures).toHaveLength(6);
    expect(new Set(fixtures.map((fixture) => pairKey(fixture.homeTeamId, fixture.awayTeamId))).size).toBe(6);
    expect(new Set(fixtures.map((fixture) => fixture.roundNumber))).toEqual(
      new Set([1, 2, 3]),
    );

    for (const roundNumber of [1, 2, 3]) {
      const participants = fixtures
        .filter((fixture) => fixture.roundNumber === roundNumber)
        .flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]);

      expect(participants).toHaveLength(4);
      expect(new Set(participants).size).toBe(4);
    }
  });

  it('gives every team exactly one bye when the team count is odd', () => {
    const oddTeams = ['A', 'B', 'C', 'D', 'E'];
    const fixtures = generateRoundRobin(oddTeams, false);

    expect(fixtures).toHaveLength(10);
    expect(new Set(fixtures.map((fixture) => fixture.roundNumber)).size).toBe(5);

    for (const teamId of oddTeams) {
      const roundsPlayed = new Set(
        fixtures
          .filter(
            (fixture) =>
              fixture.homeTeamId === teamId || fixture.awayTeamId === teamId,
          )
          .map((fixture) => fixture.roundNumber),
      );

      expect(roundsPlayed.size).toBe(4);
    }
  });

  it('creates reversed return fixtures for a double round robin', () => {
    const fixtures = generateRoundRobin(teamIds, true);

    expect(fixtures).toHaveLength(12);
    expect(new Set(fixtures.map((fixture) => fixture.roundNumber)).size).toBe(6);

    for (const firstLeg of fixtures.slice(0, 6)) {
      expect(fixtures).toContainEqual({
        awayTeamId: firstLeg.homeTeamId,
        homeTeamId: firstLeg.awayTeamId,
        position: firstLeg.position,
        roundNumber: firstLeg.roundNumber + 3,
      });
    }
  });

  it('balances home and away assignments and is deterministic', () => {
    const fixtures = generateRoundRobin(teamIds, false);

    for (const teamId of teamIds) {
      const homeCount = fixtures.filter(
        (fixture) => fixture.homeTeamId === teamId,
      ).length;
      const awayCount = fixtures.filter(
        (fixture) => fixture.awayTeamId === teamId,
      ).length;

      expect(Math.abs(homeCount - awayCount)).toBeLessThanOrEqual(1);
    }
    expect(generateRoundRobin(teamIds, false)).toEqual(fixtures);
  });

  it('generates a 32-team double round robin within one second', () => {
    const largeField = Array.from({ length: 32 }, (_, index) => `team-${index + 1}`);
    const startedAt = performance.now();
    const fixtures = generateRoundRobin(largeField, true);

    expect(fixtures).toHaveLength(992);
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
