export type RoundRobinFixture = {
  awayTeamId: string;
  homeTeamId: string;
  position: number;
  roundNumber: number;
};

function validateTeamIds(teamIds: readonly string[]): void {
  if (teamIds.length < 2) {
    throw new Error('At least two teams are required to generate fixtures.');
  }

  if (new Set(teamIds).size !== teamIds.length) {
    throw new Error('Each team can appear only once in the fixture field.');
  }
}

export function generateRoundRobin(
  teamIds: readonly string[],
  doubleRoundRobin: boolean,
): RoundRobinFixture[] {
  validateTeamIds(teamIds);

  const rotating: Array<string | null> = [...teamIds];
  if (rotating.length % 2 === 1) rotating.push(null);

  const roundCount = rotating.length - 1;
  const gamesPerRound = rotating.length / 2;
  const firstLeg: RoundRobinFixture[] = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    let position = 1;

    for (let pairingIndex = 0; pairingIndex < gamesPerRound; pairingIndex += 1) {
      const first = rotating[pairingIndex];
      const second = rotating[rotating.length - 1 - pairingIndex];

      if (first === null || second === null) continue;

      const firstIsHome =
        pairingIndex === 0 ? roundIndex % 2 === 0 : true;

      firstLeg.push({
        awayTeamId: firstIsHome ? second : first,
        homeTeamId: firstIsHome ? first : second,
        position,
        roundNumber: roundIndex + 1,
      });
      position += 1;
    }

    const fixed = rotating[0];
    const last = rotating.at(-1) ?? null;
    const middle = rotating.slice(1, -1);
    rotating.splice(0, rotating.length, fixed, last, ...middle);
  }

  if (!doubleRoundRobin) return firstLeg;

  const returnLeg = firstLeg.map((fixture) => ({
    awayTeamId: fixture.homeTeamId,
    homeTeamId: fixture.awayTeamId,
    position: fixture.position,
    roundNumber: fixture.roundNumber + roundCount,
  }));

  return [...firstLeg, ...returnLeg];
}
