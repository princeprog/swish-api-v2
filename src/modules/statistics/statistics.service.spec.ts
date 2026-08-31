import { StatisticsService } from './statistics.service';

describe('StatisticsService submission', () => {
  it('keeps the statistics state read-only before game start', async () => {
    const query = {
      execute: jest.fn().mockResolvedValue([]),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      executeTakeFirstOrThrow: jest.fn(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      insertInto: jest.fn(),
      selectFrom: jest.fn().mockReturnValue(query),
    };
    const service = new StatisticsService(db as never, {} as never);
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue({
      away_score: null,
      away_team_id: 'away-team',
      home_score: null,
      home_team_id: 'home-team',
      id: 'game-1',
      organization_id: 'org-1',
      status: 'scheduled',
    });

    await expect(
      service.getState('org-1', 'game-1', {} as never),
    ).resolves.toMatchObject({
      boxScores: [],
      events: [],
      roster: [],
      sheet: {
        away_player_points: 0,
        home_player_points: 0,
        status: 'draft',
        version: 0,
      },
      version: 0,
    });
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('reconciles a submitted stat sheet against the live score projection', async () => {
    const stateQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
      away_score: 79,
      home_score: 82,
      phase: 'period_break',
      current_period_number: 4,
      regulation_periods: 4,
      game_clock_remaining_ms: 0,
      game_clock_running: false,
      shot_clock_running: false,
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
    jest
      .spyOn(service as any, 'assertGameRosterSnapshots')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'ensureStatSheet').mockResolvedValue(undefined);
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

  it('rejects a reconciled sheet while the game is still in an active period', async () => {
    const stateQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        away_score: 79,
        home_score: 82,
        phase: 'live',
        current_period_number: 1,
        regulation_periods: 4,
        game_clock_remaining_ms: 300_000,
        game_clock_running: true,
        shot_clock_running: true,
      }),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const updateQuery = {
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockReturnThis(),
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
    jest
      .spyOn(service as any, 'assertGameRosterSnapshots')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'ensureStatSheet').mockResolvedValue(undefined);
    jest.spyOn(service, 'getState').mockResolvedValue({
      boxScores: [
        { assists: 0, playerId: 'home-player', points: 82, rebounds: 0, steals: 0, teamId: 'home-team', turnovers: 0 },
        { assists: 0, playerId: 'away-player', points: 79, rebounds: 0, steals: 0, teamId: 'away-team', turnovers: 0 },
      ],
    } as never);

    await expect(
      service.submit('org-1', 'game-1', {} as never, 'control-token'),
    ).rejects.toThrow(
      'The game must be complete and both clocks stopped before the stat sheet can be submitted.',
    );
    expect(updateQuery.set).not.toHaveBeenCalled();
  });

  it.each([
    ['running game clock', { game_clock_running: true }],
    ['running shot clock', { shot_clock_running: true }],
    ['pre-regulation period', { current_period_number: 3 }],
    ['nonzero game clock', { game_clock_remaining_ms: 1 }],
    ['wrong phase', { phase: 'paused' }],
    ['tied score', { away_score: 82 }],
  ])('rejects submission with %s', (_label, override) => {
    const service = new StatisticsService({} as never, {} as never);
    const projection = {
      awayScore: 79,
      homeScore: 82,
      away_score: 79,
      home_score: 82,
      phase: 'period_break',
      current_period_number: 4,
      regulation_periods: 4,
      game_clock_remaining_ms: 0,
      game_clock_running: false,
      shot_clock_running: false,
      ...override,
    };

    expect(() => (service as any).assertSubmissionReady(projection)).toThrow(
      'The game must be complete and both clocks stopped before the stat sheet can be submitted.',
    );
  });

  it('accepts a completed overtime period when the score is no longer tied', () => {
    const service = new StatisticsService({} as never, {} as never);

    expect(() =>
      (service as any).assertSubmissionReady({
        awayScore: 101,
        homeScore: 99,
        away_score: 101,
        home_score: 99,
        phase: 'period_break',
        current_period_number: 5,
        regulation_periods: 4,
        game_clock_remaining_ms: 0,
        game_clock_running: false,
        shot_clock_running: false,
      }),
    ).not.toThrow();
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

  it('requires the two game-start roster snapshots before recording statistics', async () => {
    const query = {
      execute: jest.fn().mockResolvedValue([{ team_id: 'home-team' }]),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new StatisticsService(
      { selectFrom: jest.fn().mockReturnValue(query) } as never,
      {} as never,
    );

    await expect(
      (service as any).assertGameRosterSnapshots({
        away_team_id: 'away-team',
        home_team_id: 'home-team',
        id: 'game-1',
      }),
    ).rejects.toThrow(
      'Start the game before recording player statistics. The published game rosters are captured when scoring begins.',
    );
  });
});
