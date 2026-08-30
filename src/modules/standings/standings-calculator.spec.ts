import {
  calculateRankedStandings,
  calculateStandings,
} from './standings-calculator';
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
        starts_at: new Date('2026-07-01T10:00:00.000Z'),
      },
      {
        away_score: 68,
        away_team_id: 'team-a',
        division_id: 'division-a',
        home_score: 71,
        home_team_id: 'team-c',
        id: 'game-2',
        starts_at: new Date('2026-07-02T10:00:00.000Z'),
      },
      {
        away_score: 60,
        away_team_id: 'team-c',
        division_id: 'division-a',
        home_score: 73,
        home_team_id: 'team-b',
        id: 'game-3',
        starts_at: new Date('2026-07-03T10:00:00.000Z'),
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
        recentResults: ['W', 'L'],
        teamId: 'team-a',
        winPercentage: 0.5,
        wins: 1,
      }),
      expect.objectContaining({
        gamesPlayed: 2,
        losses: 1,
        pointDifferential: 3,
        rank: 2,
        recentResults: ['L', 'W'],
        teamId: 'team-b',
        winPercentage: 0.5,
        wins: 1,
      }),
      expect.objectContaining({
        gamesPlayed: 2,
        losses: 1,
        pointDifferential: -10,
        rank: 3,
        recentResults: ['W', 'L'],
        teamId: 'team-c',
        winPercentage: 0.5,
        wins: 1,
      }),
    ]);
  });

  it('returns the latest five results by scheduled game date from oldest to newest', () => {
    const results: FinalizedGameResult[] = [
      {
        away_score: 50,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 60,
        home_team_id: 'team-a',
        id: 'game-1',
        starts_at: new Date('2026-07-01T10:00:00.000Z'),
      },
      {
        away_score: 65,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 60,
        home_team_id: 'team-a',
        id: 'game-2',
        starts_at: new Date('2026-07-02T10:00:00.000Z'),
      },
      {
        away_score: 55,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 70,
        home_team_id: 'team-a',
        id: 'game-3',
        starts_at: new Date('2026-07-03T10:00:00.000Z'),
      },
      {
        away_score: 58,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 80,
        home_team_id: 'team-a',
        id: 'game-4',
        starts_at: new Date('2026-07-04T10:00:00.000Z'),
      },
      {
        away_score: 90,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 89,
        home_team_id: 'team-a',
        id: 'game-5',
        starts_at: new Date('2026-07-05T10:00:00.000Z'),
      },
      {
        away_score: 70,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 95,
        home_team_id: 'team-a',
        id: 'game-6',
        starts_at: new Date('2026-07-06T10:00:00.000Z'),
      },
    ];

    expect(calculateStandings(teams, results)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recentResults: ['L', 'W', 'W', 'L', 'W'],
          teamId: 'team-a',
        }),
        expect.objectContaining({
          recentResults: ['W', 'L', 'L', 'W', 'L'],
          teamId: 'team-b',
        }),
        expect.objectContaining({
          recentResults: [],
          teamId: 'team-c',
        }),
      ]),
    );
  });

  it('uses a head-to-head mini-table before overall point differential', () => {
    const results: FinalizedGameResult[] = [
      {
        away_score: 80,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 81,
        home_team_id: 'team-a',
        id: 'game-1',
        starts_at: new Date('2026-07-01T10:00:00.000Z'),
      },
      {
        away_score: 60,
        away_team_id: 'external-team',
        division_id: 'division-a',
        home_score: 100,
        home_team_id: 'team-b',
        id: 'game-2',
        starts_at: new Date('2026-07-02T10:00:00.000Z'),
      },
      {
        away_score: 70,
        away_team_id: 'team-a',
        division_id: 'division-a',
        home_score: 110,
        home_team_id: 'external-team',
        id: 'game-3',
        starts_at: new Date('2026-07-03T10:00:00.000Z'),
      },
    ];

    const ranked = calculateRankedStandings(teams, results, [
      'win_percentage',
      'head_to_head',
      'point_differential',
      'points_for',
      'manual_decision',
    ]);

    expect(ranked.rows.map((row) => row.teamId)).toEqual([
      'team-a',
      'team-b',
      'team-c',
    ]);
    expect(ranked.rows[0].rankingExplanation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'head_to_head', value: 1 }),
      ]),
    );
  });

  it('reports an unresolved tie until an audited manual order is supplied', () => {
    const tiedTeams = teams.slice(0, 2);
    const result: FinalizedGameResult[] = [
      {
        away_score: 70,
        away_team_id: 'team-b',
        division_id: 'division-a',
        home_score: 70,
        home_team_id: 'team-a',
        id: 'game-1',
        starts_at: new Date('2026-07-01T10:00:00.000Z'),
      },
    ];

    const unresolved = calculateRankedStandings(tiedTeams, result, [
      'win_percentage',
      'point_differential',
      'points_for',
      'manual_decision',
    ]);
    const tieKey = 'team-a|team-b';
    expect(unresolved.unresolvedTies).toEqual([
      { teamIds: ['team-a', 'team-b'], tieKey },
    ]);
    expect(unresolved.rows.every((row) => row.rank === null)).toBe(true);

    const decided = calculateRankedStandings(
      tiedTeams,
      result,
      [
        'win_percentage',
        'point_differential',
        'points_for',
        'manual_decision',
      ],
      [{ orderedTeamIds: ['team-b', 'team-a'], teamIds: ['team-a', 'team-b'] }],
    );
    expect(decided.unresolvedTies).toEqual([]);
    expect(decided.rows.map((row) => [row.teamId, row.rank])).toEqual([
      ['team-b', 1],
      ['team-a', 2],
    ]);
  });
});
