import type {
  FinalizedGameResult,
  ManualTieDecision,
  RankedStandingsRow,
  RankingExplanation,
  StandingsRow,
  StandingsTeam,
  TiebreakerRule,
} from './standings.types';

type TeamGameResult = {
  result: 'W' | 'L';
  startsAt: Date;
};

function buildInitialRow(team: StandingsTeam): StandingsRow {
  return {
    divisionId: team.division_id,
    divisionName: team.division_name,
    gamesPlayed: 0,
    losses: 0,
    pointDifferential: 0,
    pointsAgainst: 0,
    pointsFor: 0,
    rank: 0,
    recentResults: [],
    teamColor: team.color,
    teamId: team.id,
    teamName: team.name,
    winPercentage: 0,
    wins: 0,
  };
}

function applyGameResult(
  row: StandingsRow,
  pointsFor: number,
  pointsAgainst: number,
): void {
  row.gamesPlayed += 1;
  row.pointsFor += pointsFor;
  row.pointsAgainst += pointsAgainst;
  row.pointDifferential = row.pointsFor - row.pointsAgainst;

  if (pointsFor > pointsAgainst) {
    row.wins += 1;
  } else {
    row.losses += 1;
  }

  row.winPercentage =
    row.gamesPlayed === 0 ? 0 : Number((row.wins / row.gamesPlayed).toFixed(3));
}

function addRecentResult(
  recentResultsByTeamId: Map<string, TeamGameResult[]>,
  teamId: string,
  result: 'W' | 'L',
  startsAt: Date,
): void {
  const recentResults = recentResultsByTeamId.get(teamId);

  if (!recentResults) {
    return;
  }

  recentResults.push({ result, startsAt });
}

function getRecentResults(teamGameResults: TeamGameResult[]): Array<'W' | 'L'> {
  return [...teamGameResults]
    .sort((left, right) => right.startsAt.getTime() - left.startsAt.getTime())
    .slice(0, 5)
    .reverse()
    .map((gameResult) => gameResult.result);
}

export function calculateStandings(
  teams: StandingsTeam[],
  finalizedResults: FinalizedGameResult[],
): StandingsRow[] {
  const rowsByTeamId = new Map(
    teams.map((team) => [team.id, buildInitialRow(team)]),
  );
  const recentResultsByTeamId = new Map(
    teams.map((team) => [team.id, [] as TeamGameResult[]]),
  );

  for (const game of finalizedResults) {
    const homeRow = rowsByTeamId.get(game.home_team_id);
    const awayRow = rowsByTeamId.get(game.away_team_id);

    if (homeRow) {
      applyGameResult(homeRow, game.home_score, game.away_score);
      addRecentResult(
        recentResultsByTeamId,
        game.home_team_id,
        game.home_score > game.away_score ? 'W' : 'L',
        game.starts_at,
      );
    }

    if (awayRow) {
      applyGameResult(awayRow, game.away_score, game.home_score);
      addRecentResult(
        recentResultsByTeamId,
        game.away_team_id,
        game.away_score > game.home_score ? 'W' : 'L',
        game.starts_at,
      );
    }
  }

  for (const row of rowsByTeamId.values()) {
    row.recentResults = getRecentResults(
      recentResultsByTeamId.get(row.teamId) ?? [],
    );
  }

  return [...rowsByTeamId.values()]
    .sort((left, right) => {
      if (right.wins !== left.wins) return right.wins - left.wins;
      if (left.losses !== right.losses) return left.losses - right.losses;
      if (right.pointDifferential !== left.pointDifferential) {
        return right.pointDifferential - left.pointDifferential;
      }
      if (right.pointsFor !== left.pointsFor)
        return right.pointsFor - left.pointsFor;
      return left.teamName.localeCompare(right.teamName);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
}

type RankingGroup = {
  resolved: boolean;
  rows: RankedStandingsRow[];
};

const RULE_LABELS: Record<TiebreakerRule, string> = {
  head_to_head: 'Head-to-head win percentage',
  manual_decision: 'League decision',
  point_differential: 'Point differential',
  points_for: 'Points scored',
  win_percentage: 'Win percentage',
};

function tieKey(teamIds: string[]): string {
  return [...teamIds].sort().join('|');
}

function headToHeadValues(
  rows: RankedStandingsRow[],
  results: FinalizedGameResult[],
): Map<string, number> {
  const teamIds = new Set(rows.map((row) => row.teamId));
  const totals = new Map(
    rows.map((row) => [row.teamId, { games: 0, wins: 0 }]),
  );

  for (const game of results) {
    if (
      !teamIds.has(game.home_team_id) ||
      !teamIds.has(game.away_team_id)
    ) {
      continue;
    }
    const home = totals.get(game.home_team_id);
    const away = totals.get(game.away_team_id);
    if (!home || !away) continue;
    home.games += 1;
    away.games += 1;
    if (game.home_score > game.away_score) home.wins += 1;
    if (game.away_score > game.home_score) away.wins += 1;
  }

  return new Map(
    [...totals].map(([teamId, total]) => [
      teamId,
      total.games === 0 ? 0 : Number((total.wins / total.games).toFixed(6)),
    ]),
  );
}

function ruleValues(
  rule: Exclude<TiebreakerRule, 'manual_decision'>,
  rows: RankedStandingsRow[],
  results: FinalizedGameResult[],
): Map<string, number> {
  if (rule === 'head_to_head') return headToHeadValues(rows, results);
  return new Map(
    rows.map((row) => [
      row.teamId,
      rule === 'win_percentage'
        ? row.winPercentage
        : rule === 'point_differential'
          ? row.pointDifferential
          : row.pointsFor,
    ]),
  );
}

function partitionByRule(
  group: RankingGroup,
  rule: Exclude<TiebreakerRule, 'manual_decision'>,
  results: FinalizedGameResult[],
): RankingGroup[] {
  if (group.rows.length < 2 || group.resolved) return [group];
  const values = ruleValues(rule, group.rows, results);
  const buckets = new Map<number, RankedStandingsRow[]>();
  for (const row of group.rows) {
    const value = values.get(row.teamId) ?? 0;
    const explanation: RankingExplanation = {
      label: RULE_LABELS[rule],
      rule,
      value,
    };
    const enriched = {
      ...row,
      rankingExplanation: [...row.rankingExplanation, explanation],
    };
    buckets.set(value, [...(buckets.get(value) ?? []), enriched]);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, rows]) => ({ resolved: rows.length === 1, rows }));
}

export function calculateRankedStandings(
  teams: StandingsTeam[],
  finalizedResults: FinalizedGameResult[],
  tiebreakers: TiebreakerRule[],
  manualDecisions: ManualTieDecision[] = [],
): {
  rows: RankedStandingsRow[];
  unresolvedTies: Array<{ teamIds: string[]; tieKey: string }>;
} {
  const baseRows: RankedStandingsRow[] = calculateStandings(
    teams,
    finalizedResults,
  ).map((row) => ({
    ...row,
    rank: null,
    rankingExplanation: [],
    unresolvedTieKey: null,
  }));
  let groups: RankingGroup[] = [{ resolved: baseRows.length === 1, rows: baseRows }];

  for (const rule of tiebreakers) {
    if (rule === 'manual_decision') continue;
    groups = groups.flatMap((group) =>
      partitionByRule(group, rule, finalizedResults),
    );
  }

  const decisions = new Map(
    manualDecisions.map((decision) => [tieKey(decision.teamIds), decision]),
  );
  const unresolvedTies: Array<{ teamIds: string[]; tieKey: string }> = [];
  const orderedGroups = groups.map((group): RankingGroup => {
    if (group.rows.length < 2) return { ...group, resolved: true };
    const teamIds = group.rows.map((row) => row.teamId).sort();
    const key = tieKey(teamIds);
    const decision = decisions.get(key);
    if (decision) {
      const order = new Map(
        decision.orderedTeamIds.map((teamId, index) => [teamId, index]),
      );
      return {
        resolved: true,
        rows: [...group.rows]
          .sort(
            (left, right) =>
              (order.get(left.teamId) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(right.teamId) ?? Number.MAX_SAFE_INTEGER),
          )
          .map((row) => ({
            ...row,
            rankingExplanation: [
              ...row.rankingExplanation,
              {
                label: RULE_LABELS.manual_decision,
                rule: 'manual_decision',
                value: 'Confirmed by a league administrator',
              },
            ],
          })),
      };
    }
    unresolvedTies.push({ teamIds, tieKey: key });
    return {
      resolved: false,
      rows: [...group.rows]
        .sort((left, right) => left.teamName.localeCompare(right.teamName))
        .map((row) => ({ ...row, unresolvedTieKey: key })),
    };
  });

  let position = 0;
  const rows = orderedGroups.flatMap((group) =>
    group.rows.map((row) => {
      position += 1;
      return { ...row, rank: group.resolved ? position : null };
    }),
  );
  return { rows, unresolvedTies };
}
