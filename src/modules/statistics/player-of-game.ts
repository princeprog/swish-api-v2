import type { PlayerBoxScore } from './statistics-engine';

export type PlayerOfGameCandidate = PlayerBoxScore & {
  playerName?: string;
};

export type PlayerOfGameSuggestion = {
  metricScore: number;
  playerId: string;
  teamId: string;
};

export function playerOfGameMetric(candidate: PlayerOfGameCandidate): number {
  return (
    candidate.points +
    candidate.rebounds +
    candidate.assists +
    candidate.steals -
    candidate.turnovers
  );
}

export function suggestPlayerOfGame(
  candidates: PlayerOfGameCandidate[],
  winningTeamId: string,
): PlayerOfGameSuggestion | null {
  const ranked = [...candidates].sort((left, right) => {
    const metricDifference = playerOfGameMetric(right) - playerOfGameMetric(left);
    if (metricDifference !== 0) return metricDifference;
    const leftWinner = left.teamId === winningTeamId ? 1 : 0;
    const rightWinner = right.teamId === winningTeamId ? 1 : 0;
    if (rightWinner !== leftWinner) return rightWinner - leftWinner;
    return left.playerId.localeCompare(right.playerId);
  });
  const selected = ranked[0];
  return selected
    ? {
        metricScore: playerOfGameMetric(selected),
        playerId: selected.playerId,
        teamId: selected.teamId,
      }
    : null;
}
