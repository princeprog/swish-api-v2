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

export type TiebreakerRule =
  | 'win_percentage'
  | 'head_to_head'
  | 'point_differential'
  | 'points_for'
  | 'manual_decision';

export type RankingExplanation = {
  label: string;
  rule: TiebreakerRule;
  value: number | string;
};

export type RankedStandingsRow = Omit<StandingsRow, 'rank'> & {
  rank: number | null;
  rankingExplanation: RankingExplanation[];
  unresolvedTieKey: string | null;
};

export type ManualTieDecision = {
  orderedTeamIds: string[];
  teamIds: string[];
};
