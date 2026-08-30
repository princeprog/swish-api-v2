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

export type ReopenDependencyMatchup = {
  id: string;
  loserToMatchupId: string | null;
  winnerToMatchupId: string | null;
};

export function orderDownstreamMatchupsForReopen(
  matchups: ReopenDependencyMatchup[],
  sourceMatchupId: string,
): string[] {
  const byId = new Map(matchups.map((matchup) => [matchup.id, matchup]));
  const depths = new Map<string, number>();

  const visit = (matchupId: string, depth: number, path: Set<string>) => {
    if (matchupId === sourceMatchupId || path.has(matchupId)) return;
    depths.set(matchupId, Math.max(depths.get(matchupId) ?? 0, depth));
    const matchup = byId.get(matchupId);
    if (!matchup) return;
    const nextPath = new Set(path).add(matchupId);
    for (const targetId of [
      matchup.winnerToMatchupId,
      matchup.loserToMatchupId,
    ]) {
      if (targetId) visit(targetId, depth + 1, nextPath);
    }
  };

  const source = byId.get(sourceMatchupId);
  if (!source) return [];
  for (const targetId of [
    source.winnerToMatchupId,
    source.loserToMatchupId,
  ]) {
    if (targetId) visit(targetId, 1, new Set([sourceMatchupId]));
  }

  return [...depths.entries()]
    .sort(
      ([leftId, leftDepth], [rightId, rightDepth]) =>
        rightDepth - leftDepth || leftId.localeCompare(rightId),
    )
    .map(([matchupId]) => matchupId);
}

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
