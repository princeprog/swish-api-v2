import { calculateStandings } from './standings-calculator';
import type { FinalizedGameResult, StandingsTeam } from './standings.types';

describe('calculateStandings', () => {
  const teams: StandingsTeam[] = [
    {
      color: '#111111',
      division_id: 'division-a',
      division_name: '18 under',
      id: 'team-a',
      name: 'Bugho Slashers',
    },
    {
      color: '#222222',
      division_id: 'division-a',
      division_name: '18 under',
      id: 'team-b',
      name: 'Cebu',
    },
    {
      color: null,
      division_id: 'division-a',
      division_name: '18 under',
      id: 'team-c',
      name: 'Lapu-Lapu',
    },
  ];

  it('includes teams with no finalized games as zero-record rows', () => {
    expect(calculateStandings(teams, [])).toEqual([
      expect.objectContaining({
        gamesPlayed: 0,
        losses: 0,
        rank: 1,
        teamId: 'team-a',
        winPercentage: 0,
        wins: 0,
      }),
      expect.objectContaining({
        gamesPlayed: 0,
        losses: 0,
        rank: 2,
        teamId: 'team-b',
        winPercentage: 0,
        wins: 0,
      }),
      expect.objectContaining({
        gamesPlayed: 0,
        losses: 0,
        rank: 3,
        teamId: 'team-c',
        winPercentage: 0,
        wins: 0,
      }),
    ]);
  });

  it('counts wins, losses, points, and sorts official standings rows', () => {
    const results: FinalizedGameResult[] = [
      {
        away_score: 70,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 80,
        home_team_id: 'team-a',
        id: 'game-1',
      },
      {
        away_score: 68,
        away_team_id: 'team-a',
        division_id: 'division-a',
        home_score: 71,
        home_team_id: 'team-c',
        id: 'game-2',
      },
      {
        away_score: 60,
        away_team_id: 'team-c',
        division_id: 'division-a',
        home_score: 73,
        home_team_id: 'team-b',
        id: 'game-3',
      },
    ];

    expect(calculateStandings(teams, results)).toEqual([
      expect.objectContaining({
        gamesPlayed: 2,
        losses: 1,
        pointDifferential: 7,
        pointsAgainst: 141,
        pointsFor: 148,
        rank: 1,
        teamId: 'team-a',
        winPercentage: 0.5,
        wins: 1,
      }),
      expect.objectContaining({
        gamesPlayed: 2,
        losses: 1,
        pointDifferential: 3,
        rank: 2,
        teamId: 'team-b',
        winPercentage: 0.5,
        wins: 1,
      }),
      expect.objectContaining({
        gamesPlayed: 2,
        losses: 1,
        pointDifferential: -10,
        rank: 3,
        teamId: 'team-c',
        winPercentage: 0.5,
        wins: 1,
      }),
    ]);
  });
});
