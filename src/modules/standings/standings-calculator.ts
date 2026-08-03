import type {
  FinalizedGameResult,
  StandingsRow,
  StandingsTeam,
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
