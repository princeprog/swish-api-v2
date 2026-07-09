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
  it('queries teams and finalized results for one organization season', async () => {
    const teamQuery = queryBuilder([
      {
        color: null,
        division_id: 'division-1',
        division_name: '18 under',
        id: 'team-a',
        name: 'Bugho Slashers',
      },
      {
        color: null,
        division_id: 'division-1',
        division_name: '18 under',
        id: 'team-b',
        name: 'Cebu',
      },
    ]);
    const resultQuery = queryBuilder([
      {
        away_score: 70,
        away_team_id: 'team-b',
        division_id: 'division-1',
        home_score: 82,
        home_team_id: 'team-a',
        id: 'game-1',
      },
    ]);
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(teamQuery)
        .mockReturnValueOnce(resultQuery),
    };
    const service = new StandingsService(db as never);

    const standings = await service.findAll('org-1', {
      leagueSeasonId: 'season-1',
    });

    expect(db.selectFrom).toHaveBeenCalledWith('admin.teams as teams');
    expect(db.selectFrom).toHaveBeenCalledWith(
      'competition.finalized_game_results as results',
    );
    expect(teamQuery.where).toHaveBeenCalledWith(
      'league_seasons.organization_id',
      '=',
      'org-1',
    );
    expect(teamQuery.where).toHaveBeenCalledWith(
      'divisions.league_season_id',
      '=',
      'season-1',
    );
    expect(resultQuery.where).toHaveBeenCalledWith(
      'results.organization_id',
      '=',
      'org-1',
    );
    expect(resultQuery.where).toHaveBeenCalledWith(
      'results.league_season_id',
      '=',
      'season-1',
    );
    expect(standings.rows).toEqual([
      expect.objectContaining({ losses: 0, teamId: 'team-a', wins: 1 }),
      expect.objectContaining({ losses: 1, teamId: 'team-b', wins: 0 }),
    ]);
    expect(standings.finalizedGamesCount).toBe(1);
  });
});
