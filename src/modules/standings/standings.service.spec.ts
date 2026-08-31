import { StandingsService } from './standings.service';

function queryBuilder(result: unknown) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(result),
  };
}

describe('StandingsService', () => {
  it('reads the authoritative standings projections for one organization season', async () => {
    const standingsQuery = queryBuilder([
      {
        division_id: 'division-1',
        division_name: '18 under',
        games_played: 1,
        losses: 0,
        point_differential: 12,
        points_against: 70,
        points_for: 82,
        pool_code: 'A',
        pool_name: 'Pool A',
        qualification_status: 'pending',
        rank: 1,
        ranking_explanation: [],
        team_color: null,
        team_id: 'team-a',
        team_name: 'Bugho Slashers',
        unresolved_tie_key: null,
        win_percentage: '1.000000',
        wins: 1,
      },
      {
        division_id: 'division-1',
        division_name: '18 under',
        games_played: 1,
        losses: 1,
        point_differential: -12,
        points_against: 82,
        points_for: 70,
        pool_code: 'A',
        pool_name: 'Pool A',
        qualification_status: 'pending',
        rank: 2,
        ranking_explanation: [],
        team_color: null,
        team_id: 'team-b',
        team_name: 'Cebu',
        unresolved_tie_key: null,
        win_percentage: '0.000000',
        wins: 0,
      },
    ]);
    const db = { selectFrom: jest.fn().mockReturnValue(standingsQuery) };
    const service = new StandingsService(db as never);

    const standings = await service.findAll('org-1', {
      leagueSeasonId: 'season-1',
    });

    expect(db.selectFrom).toHaveBeenCalledWith(
      'competition.standings_projections as standings',
    );
    expect(standingsQuery.where).toHaveBeenCalledWith(
      'seasons.organization_id',
      '=',
      'org-1',
    );
    expect(standingsQuery.where).toHaveBeenCalledWith(
      'seasons.id',
      '=',
      'season-1',
    );
    expect(standings.rows).toEqual([
      expect.objectContaining({
        losses: 0,
        rank: 1,
        teamId: 'team-a',
        wins: 1,
      }),
      expect.objectContaining({
        losses: 1,
        rank: 2,
        teamId: 'team-b',
        wins: 0,
      }),
    ]);
    expect(standings.finalizedGamesCount).toBe(1);
  });
});
