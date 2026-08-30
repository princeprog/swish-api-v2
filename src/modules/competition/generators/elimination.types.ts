export type MatchupSourceType =
  | 'team'
  | 'pool_seed'
  | 'matchup_winner'
  | 'matchup_loser'
  | 'bye';

export type MatchupSource = {
  ref: string | null;
  type: MatchupSourceType;
};

export type MatchupDependency = {
  matchupKey: string;
  slot: 'home' | 'away';
};

export type EliminationMatchup = {
  awaySource: MatchupSource;
  bracketSide: 'winners' | 'losers' | 'finals';
  homeSource: MatchupSource;
  isResetFinal: boolean;
  key: string;
  label: string;
  loserTo: MatchupDependency | null;
  position: number;
  roundNumber: number;
  winnerTo: MatchupDependency | null;
};
