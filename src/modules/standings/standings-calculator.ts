import type {
  FinalizedGameResult,
  StandingsRow,
  StandingsTeam,
} from './standings.types';

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

export function calculateStandings(
  teams: StandingsTeam[],
  finalizedResults: FinalizedGameResult[],
): StandingsRow[] {
  const rowsByTeamId = new Map(
    teams.map((team) => [team.id, buildInitialRow(team)]),
  );

  for (const game of finalizedResults) {
    const homeRow = rowsByTeamId.get(game.home_team_id);
    const awayRow = rowsByTeamId.get(game.away_team_id);

    if (homeRow) {
      applyGameResult(homeRow, game.home_score, game.away_score);
    }

    if (awayRow) {
      applyGameResult(awayRow, game.away_score, game.home_score);
    }
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
