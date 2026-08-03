export type StandingsTeam = {
  color: string | null;
  division_id: string;
  division_name: string;
  id: string;
  name: string;
};

export type FinalizedGameResult = {
  away_score: number;
  away_team_id: string;
  division_id: string;
  home_score: number;
  home_team_id: string;
  id: string;
  starts_at: Date;
};

export type StandingsRow = {
  divisionId: string;
  divisionName: string;
  gamesPlayed: number;
  losses: number;
  pointDifferential: number;
  pointsAgainst: number;
  pointsFor: number;
  rank: number;
  recentResults: Array<'W' | 'L'>;
  teamColor: string | null;
  teamId: string;
  teamName: string;
  winPercentage: number;
  wins: number;
};
