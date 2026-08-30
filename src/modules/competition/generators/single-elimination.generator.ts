import type {
  EliminationMatchup,
  MatchupSource,
} from './elimination.types';

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

function seededPositions(size: number): number[] {
  let positions = [1, 2];

  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    positions = positions.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }

  return positions;
}

function teamSource(teamId: string | undefined): MatchupSource {
  return teamId
    ? { ref: teamId, type: 'team' }
    : { ref: null, type: 'bye' };
}

export function generateSingleElimination(
  seededTeamIds: readonly string[],
): EliminationMatchup[] {
  if (seededTeamIds.length < 2) {
    throw new Error('At least two teams are required to generate a bracket.');
  }
  if (new Set(seededTeamIds).size !== seededTeamIds.length) {
    throw new Error('Each seed must identify a different team.');
  }

  const bracketSize = nextPowerOfTwo(seededTeamIds.length);
  const roundCount = Math.log2(bracketSize);
  const positions = seededPositions(bracketSize);
  const matchups: EliminationMatchup[] = [];

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchupCount = bracketSize / 2 ** roundNumber;

    for (let position = 1; position <= matchupCount; position += 1) {
      const key = `SE-R${roundNumber}-M${position}`;
      const isFinal = roundNumber === roundCount;
      const nextKey = isFinal
        ? null
        : `SE-R${roundNumber + 1}-M${Math.ceil(position / 2)}`;
      const homeSource =
        roundNumber === 1
          ? teamSource(seededTeamIds[positions[(position - 1) * 2] - 1])
          : {
              ref: `SE-R${roundNumber - 1}-M${position * 2 - 1}`,
              type: 'matchup_winner' as const,
            };
      const awaySource =
        roundNumber === 1
          ? teamSource(seededTeamIds[positions[(position - 1) * 2 + 1] - 1])
          : {
              ref: `SE-R${roundNumber - 1}-M${position * 2}`,
              type: 'matchup_winner' as const,
            };

      matchups.push({
        awaySource,
        bracketSide: isFinal ? 'finals' : 'winners',
        homeSource,
        isResetFinal: false,
        key,
        label: isFinal ? 'Championship' : `Round ${roundNumber}`,
        loserTo: null,
        position,
        roundNumber,
        winnerTo: nextKey
          ? {
              matchupKey: nextKey,
              slot: position % 2 === 1 ? 'home' : 'away',
            }
          : null,
      });
    }
  }

  return matchups;
}
