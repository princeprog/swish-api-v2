import { StatisticsService } from './statistics.service';

describe('StatisticsService submission', () => {
  it('reconciles a submitted stat sheet against the live score projection', async () => {
    const stateQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        away_score: 79,
        home_score: 82,
      }),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const updateSet = jest.fn().mockReturnThis();
    const updateQuery = {
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({}),
      set: updateSet,
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(stateQuery),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const service = new StatisticsService(db as never, {} as never);
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue({
      away_score: null,
      away_team_id: 'away-team',
      home_score: null,
      home_team_id: 'home-team',
      id: 'game-1',
      organization_id: 'org-1',
      status: 'live',
    });
    jest.spyOn(service as any, 'assertControl').mockResolvedValue(undefined);
    jest.spyOn(service, 'getState').mockResolvedValue({
      boxScores: [
        {
          assists: 0,
          playerId: 'home-player',
          points: 82,
          rebounds: 0,
          steals: 0,
          teamId: 'home-team',
          turnovers: 0,
        },
        {
          assists: 0,
          playerId: 'away-player',
          points: 79,
          rebounds: 0,
          steals: 0,
          teamId: 'away-team',
          turnovers: 0,
        },
      ],
    } as never);

    await expect(
      service.submit('org-1', 'game-1', {} as never, 'control-token'),
    ).resolves.toEqual(
      expect.objectContaining({
        reconciliation: expect.objectContaining({ reconciled: true }),
        status: 'submitted',
      }),
    );
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted' }),
    );
  });

  it('requires a reason when confirming someone other than the suggestion', async () => {
    const service = new StatisticsService({} as never, {} as never);
    jest.spyOn(service, 'getPlayerOfGame').mockResolvedValue({
      award: {},
      candidates: [
        { playerId: 'suggested-player' },
        { playerId: 'selected-player' },
      ],
      suggestion: {
        metricScore: 30,
        playerId: 'suggested-player',
        teamId: 'team-a',
      },
    } as never);

    await expect(
      service.confirmPlayerOfGame(
        'org-1',
        'game-1',
        {
          membershipId: 'member-1',
          organizationId: 'org-1',
          permissions: [],
          role: 'admin',
          userId: 'user-1',
        },
        'selected-player',
      ),
    ).rejects.toThrow(
      'Explain why another player was selected instead of the suggested player.',
    );
  });

  it('routes finalized stat sheet corrections through official result reopening', async () => {
    const coordinator = {
      reopen: jest.fn().mockResolvedValue({
        gameId: 'game-1',
        unscheduledGameIds: [],
      }),
    };
    const service = new StatisticsService({} as never, coordinator as never);
    const access = {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: ['game.stats.override'],
      role: 'admin',
      userId: 'user-1',
    };
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue({
      id: 'game-1',
      status: 'final',
    });

    await expect(
      service.reopen(
        'org-1',
        'game-1',
        access as never,
        'Correct an attributed rebound.',
      ),
    ).resolves.toEqual({ gameId: 'game-1', unscheduledGameIds: [] });
    expect(coordinator.reopen).toHaveBeenCalledWith({
      access,
      gameId: 'game-1',
      organizationId: 'org-1',
      reason: 'Correct an attributed rebound.',
    });
  });
});
