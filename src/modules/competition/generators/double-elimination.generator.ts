import type {
  EliminationMatchup,
  MatchupDependency,
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

function dependency(
  matchupKey: string,
  slot: 'home' | 'away',
): MatchupDependency {
  return { matchupKey, slot };
}

export function generateDoubleElimination(
  seededTeamIds: readonly string[],
): EliminationMatchup[] {
  if (seededTeamIds.length < 2) {
    throw new Error('At least two teams are required to generate a bracket.');
  }
  if (new Set(seededTeamIds).size !== seededTeamIds.length) {
    throw new Error('Each seed must identify a different team.');
  }

  const bracketSize = nextPowerOfTwo(seededTeamIds.length);
  const winnersRoundCount = Math.log2(bracketSize);
  const losersRoundCount = Math.max(0, winnersRoundCount * 2 - 2);
  const positions = seededPositions(bracketSize);
  const winners: EliminationMatchup[] = [];
  const losers: EliminationMatchup[] = [];

  for (
    let roundNumber = 1;
    roundNumber <= winnersRoundCount;
    roundNumber += 1
  ) {
    const matchupCount = bracketSize / 2 ** roundNumber;

    for (let position = 1; position <= matchupCount; position += 1) {
      const key = `WB-R${roundNumber}-M${position}`;
      const isWinnersFinal = roundNumber === winnersRoundCount;
      const homeSource =
        roundNumber === 1
          ? teamSource(seededTeamIds[positions[(position - 1) * 2] - 1])
          : {
              ref: `WB-R${roundNumber - 1}-M${position * 2 - 1}`,
              type: 'matchup_winner' as const,
            };
      const awaySource =
        roundNumber === 1
          ? teamSource(seededTeamIds[positions[(position - 1) * 2 + 1] - 1])
          : {
              ref: `WB-R${roundNumber - 1}-M${position * 2}`,
              type: 'matchup_winner' as const,
            };
      const loserTo =
        winnersRoundCount === 1
          ? dependency('GF-1', 'away')
          : roundNumber === 1
            ? dependency(
                `LB-R1-M${Math.ceil(position / 2)}`,
                position % 2 === 1 ? 'home' : 'away',
              )
            : dependency(`LB-R${roundNumber * 2 - 2}-M${position}`, 'away');

      winners.push({
        awaySource,
        bracketSide: 'winners',
        homeSource,
        isResetFinal: false,
        key,
        label: isWinnersFinal
          ? 'Winners Bracket Final'
          : `Winners Round ${roundNumber}`,
        loserTo,
        position,
        roundNumber,
        winnerTo: isWinnersFinal
          ? dependency('GF-1', 'home')
          : dependency(
              `WB-R${roundNumber + 1}-M${Math.ceil(position / 2)}`,
              position % 2 === 1 ? 'home' : 'away',
            ),
      });
    }
  }

  for (
    let roundNumber = 1;
    roundNumber <= losersRoundCount;
    roundNumber += 1
  ) {
    const isOddRound = roundNumber % 2 === 1;
    const matchupCount = isOddRound
      ? bracketSize / 2 ** ((roundNumber + 3) / 2)
      : bracketSize / 2 ** (roundNumber / 2 + 1);

    for (let position = 1; position <= matchupCount; position += 1) {
      const key = `LB-R${roundNumber}-M${position}`;
      const isLosersFinal = roundNumber === losersRoundCount;
      const homeSource: MatchupSource =
        roundNumber === 1
          ? {
              ref: `WB-R1-M${position * 2 - 1}`,
              type: 'matchup_loser',
            }
          : isOddRound
            ? {
                ref: `LB-R${roundNumber - 1}-M${position * 2 - 1}`,
                type: 'matchup_winner',
              }
            : {
                ref: `LB-R${roundNumber - 1}-M${position}`,
                type: 'matchup_winner',
              };
      const awaySource: MatchupSource =
        roundNumber === 1
          ? {
              ref: `WB-R1-M${position * 2}`,
              type: 'matchup_loser',
            }
          : isOddRound
            ? {
                ref: `LB-R${roundNumber - 1}-M${position * 2}`,
                type: 'matchup_winner',
              }
            : {
                ref: `WB-R${roundNumber / 2 + 1}-M${position}`,
                type: 'matchup_loser',
              };

      losers.push({
        awaySource,
        bracketSide: 'losers',
        homeSource,
        isResetFinal: false,
        key,
        label: isLosersFinal
          ? 'Losers Bracket Final'
          : `Losers Round ${roundNumber}`,
        loserTo: null,
        position,
        roundNumber,
        winnerTo: isLosersFinal
          ? dependency('GF-1', 'away')
          : isOddRound
            ? dependency(`LB-R${roundNumber + 1}-M${position}`, 'home')
            : dependency(
                `LB-R${roundNumber + 1}-M${Math.ceil(position / 2)}`,
                position % 2 === 1 ? 'home' : 'away',
              ),
      });
    }
  }

  const winnersFinalKey = `WB-R${winnersRoundCount}-M1`;
  const losersFinalKey =
    losersRoundCount === 0
      ? winnersFinalKey
      : `LB-R${losersRoundCount}-M1`;
  const grandFinal: EliminationMatchup = {
    awaySource: {
      ref: losersFinalKey,
      type:
        losersRoundCount === 0 ? 'matchup_loser' : 'matchup_winner',
    },
    bracketSide: 'finals',
    homeSource: { ref: winnersFinalKey, type: 'matchup_winner' },
    isResetFinal: false,
    key: 'GF-1',
    label: 'Grand Final',
    loserTo: dependency('GF-RESET', 'away'),
    position: 1,
    roundNumber: 1,
    winnerTo: dependency('GF-RESET', 'home'),
  };
  const resetFinal: EliminationMatchup = {
    awaySource: { ref: 'GF-1', type: 'matchup_loser' },
    bracketSide: 'finals',
    homeSource: { ref: 'GF-1', type: 'matchup_winner' },
    isResetFinal: true,
    key: 'GF-RESET',
    label: 'Grand Final Reset',
    loserTo: null,
    position: 1,
    roundNumber: 2,
    winnerTo: null,
  };

  return [...winners, ...losers, grandFinal, resetFinal];
}
