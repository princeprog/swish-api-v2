import type { CompetitionPlanMatchup } from './competition-plan.builder';
import type { MatchupSource } from './generators/elimination.types';

export type ResolvedGeneratedMatchup = CompetitionPlanMatchup & {
  loserTeamId: string | null;
  status: 'final' | 'pending' | 'ready' | 'void';
  winnerTeamId: string | null;
};

export type ByeProgressionMatchup = ResolvedGeneratedMatchup;

export function resolveByeProgression(
  matchups: ByeProgressionMatchup[],
): ByeProgressionMatchup[] {
  const resolved = new Map(matchups.map((matchup) => [matchup.key, matchup]));

  const sourceValue = (
    source: MatchupSource,
    currentTeamId: string | null,
  ) => {
    if (source.type === 'team') {
      return { resolved: true, teamId: currentTeamId ?? source.ref };
    }
    if (source.type === 'bye') {
      return { resolved: true, teamId: null };
    }
    if (source.type === 'pool_seed') {
      return { resolved: currentTeamId !== null, teamId: currentTeamId };
    }
    const sourceMatchup = source.ref ? resolved.get(source.ref) : null;
    if (
      !sourceMatchup ||
      !['final', 'void'].includes(sourceMatchup.status)
    ) {
      return { resolved: false, teamId: null };
    }
    return {
      resolved: true,
      teamId:
        source.type === 'matchup_winner'
          ? sourceMatchup.winnerTeamId
          : sourceMatchup.loserTeamId,
    };
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const matchup of resolved.values()) {
      if (
        matchup.stage !== 'playoff' ||
        ['final', 'void'].includes(matchup.status)
      ) {
        continue;
      }
      const home = sourceValue(matchup.homeSource, matchup.homeTeamId);
      const away = sourceValue(matchup.awaySource, matchup.awayTeamId);
      if (!home.resolved || !away.resolved) continue;

      const nextHome = home.teamId;
      const nextAway = away.teamId;
      const teamCount = Number(Boolean(nextHome)) + Number(Boolean(nextAway));
      const status =
        teamCount === 2 ? 'ready' : teamCount === 1 ? 'final' : 'void';
      const winnerTeamId = teamCount === 1 ? nextHome ?? nextAway : null;
      if (
        matchup.homeTeamId !== nextHome ||
        matchup.awayTeamId !== nextAway ||
        matchup.status !== status ||
        matchup.winnerTeamId !== winnerTeamId
      ) {
        resolved.set(matchup.key, {
          ...matchup,
          awayTeamId: nextAway,
          homeTeamId: nextHome,
          status,
          winnerTeamId,
        });
        changed = true;
      }
    }
  }

  return matchups.map((matchup) => resolved.get(matchup.key)!);
}

export function resolveGeneratedByes(
  plan: CompetitionPlanMatchup[],
): ResolvedGeneratedMatchup[] {
  return resolveByeProgression(
    plan.map((matchup) => ({
      ...matchup,
      loserTeamId: null,
      status: matchup.homeTeamId && matchup.awayTeamId ? 'ready' : 'pending',
      winnerTeamId: null,
    })),
  );
}
