export class OfficialResultPolicyError extends Error {}

export type StatisticsGateSheet = {
  awayPlayerPoints: number;
  homePlayerPoints: number;
  overrideReason: string | null;
  status: string;
};

export type MatchupProgressionContext = {
  awayTeamId: string;
  bracketSide: string;
  homeTeamId: string;
  id: string;
  isResetFinal: boolean;
  loserToMatchupId: string | null;
  loserToSlot: string | null;
  winnerToMatchupId: string | null;
  winnerToSlot: string | null;
};

export type MatchupProgressionPlan = {
  championTeamId: string | null;
  eliminatedTeamIds: string[];
  targetSlots: Array<{
    matchupId: string;
    slot: 'home' | 'away';
    teamId: string;
  }>;
  voidMatchupIds: string[];
};

export function assertOfficialResultScore(
  homeScore: number,
  awayScore: number,
): void {
  if (
    !Number.isInteger(homeScore) ||
    !Number.isInteger(awayScore) ||
    homeScore < 0 ||
    awayScore < 0
  ) {
    throw new OfficialResultPolicyError(
      'Enter a valid non-negative whole-number score for both teams.',
    );
  }
  if (homeScore === awayScore) {
    throw new OfficialResultPolicyError(
      'Basketball games need a winning team before they can be finalized.',
    );
  }
}

export function assertStatisticsGate(
  sheet: StatisticsGateSheet | null,
  score: { awayScore: number; homeScore: number },
  statisticianAssigned: boolean,
): void {
  if (!statisticianAssigned) return;
  if (!sheet || sheet.status !== 'submitted') {
    throw new OfficialResultPolicyError(
      'The assigned statistician must submit the player stat sheet before this game can be finalized.',
    );
  }
  const reconciled =
    sheet.homePlayerPoints === score.homeScore &&
    sheet.awayPlayerPoints === score.awayScore;
  if (!reconciled && !sheet.overrideReason?.trim()) {
    throw new OfficialResultPolicyError(
      'Player statistics must match both official team scores before finalization. Correct the stat sheet or record an approved discrepancy reason.',
    );
  }
}

function asSlot(value: string | null): 'home' | 'away' | null {
  return value === 'home' || value === 'away' ? value : null;
}

export function planMatchupProgression(
  matchup: MatchupProgressionContext,
  winnerTeamId: string,
  loserTeamId: string,
): MatchupProgressionPlan {
  const winnerSlot = asSlot(matchup.winnerToSlot);
  const loserSlot = asSlot(matchup.loserToSlot);
  const targetSlots: MatchupProgressionPlan['targetSlots'] = [];

  const resetFinalId =
    matchup.bracketSide === 'finals' && !matchup.isResetFinal
      ? matchup.winnerToMatchupId
      : null;
  const winnersBracketTeamWonGrandFinal =
    resetFinalId !== null && winnerTeamId === matchup.homeTeamId;

  if (winnersBracketTeamWonGrandFinal) {
    return {
      championTeamId: winnerTeamId,
      eliminatedTeamIds: [loserTeamId],
      targetSlots: [],
      voidMatchupIds: [resetFinalId],
    };
  }

  if (matchup.winnerToMatchupId && winnerSlot) {
    targetSlots.push({
      matchupId: matchup.winnerToMatchupId,
      slot: winnerSlot,
      teamId: winnerTeamId,
    });
  }
  if (matchup.loserToMatchupId && loserSlot) {
    targetSlots.push({
      matchupId: matchup.loserToMatchupId,
      slot: loserSlot,
      teamId: loserTeamId,
    });
  }

  const isChampion = !matchup.winnerToMatchupId;
  const isEliminated = !matchup.loserToMatchupId;
  return {
    championTeamId: isChampion ? winnerTeamId : null,
    eliminatedTeamIds: isEliminated ? [loserTeamId] : [],
    targetSlots,
    voidMatchupIds: [],
  };
}
