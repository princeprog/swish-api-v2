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
    const sheetQuery = {
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'sheet-1',
        status: 'draft',
      }),
      forUpdate: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const boxScoreQuery = {
      execute: jest.fn().mockResolvedValue([
        {
          assists: 0,
          game_roster_player_id: 'home-player',
          points: 82,
          rebounds: 0,
          steals: 0,
          team_id: 'home-team',
          turnovers: 0,
        },
        {
          assists: 0,
          game_roster_player_id: 'away-player',
          points: 79,
          rebounds: 0,
          steals: 0,
          team_id: 'away-team',
          turnovers: 0,
        },
      ]),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const updateSet = jest.fn().mockReturnThis();
    const updateQuery = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: updateSet,
      where: jest.fn().mockReturnThis(),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        selectFrom: jest.fn((table: string) =>
          table === 'statistics.game_stat_sheets'
            ? sheetQuery
            : boxScoreQuery,
        ),
        updateTable: jest.fn().mockReturnValue(updateQuery),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
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
    jest.spyOn(service as any, 'lockGameForStatistics').mockResolvedValue({
      away_team_id: 'away-team',
      home_team_id: 'home-team',
      id: 'game-1',
    });
    jest
      .spyOn(service as any, 'lockExistingScoringState')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'findLiveOfficialScore').mockResolvedValue({
      away_score: 79,
      home_score: 82,
      phase: 'period_break',
      current_period_number: 4,
      regulation_periods: 4,
      game_clock_remaining_ms: 0,
      game_clock_running: false,
      shot_clock_running: false,
    });

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
    const sheetQuery = {
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'sheet-1',
        status: 'draft',
      }),
      forUpdate: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const updateQuery = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        selectFrom: jest.fn().mockReturnValue(sheetQuery),
        updateTable: jest.fn().mockReturnValue(updateQuery),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
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
    jest.spyOn(service as any, 'lockGameForStatistics').mockResolvedValue({
      away_team_id: 'away-team',
      home_team_id: 'home-team',
      id: 'game-1',
    });
    jest
      .spyOn(service as any, 'lockExistingScoringState')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'findLiveOfficialScore').mockResolvedValue({
      away_score: 79,
      home_score: 82,
      phase: 'live',
      current_period_number: 1,
      regulation_periods: 4,
      game_clock_remaining_ms: 300_000,
      game_clock_running: true,
      shot_clock_running: true,
    });

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

describe('StatisticsService transactional control', () => {
  it('claims control after locking the game, scoring state, and active session', async () => {
    const game = {
      away_score: null,
      away_team_id: 'away-team',
      home_score: null,
      home_team_id: 'home-team',
      id: 'game-1',
      organization_id: 'org-1',
      status: 'live',
    };
    const gameQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(game),
      forUpdate: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const stateQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const controlQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      forUpdate: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const insertQuery = {
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
        expires_at: new Date('2026-08-04T10:01:30.000Z'),
        id: 'control-1',
      }),
      returning: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn().mockReturnValue(insertQuery),
        selectFrom: jest.fn((table: string) =>
          table.startsWith('competition.')
            ? gameQuery
            : table === 'scoring.game_states'
              ? stateQuery
              : controlQuery,
        ),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new StatisticsService(db as never, {} as never);
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue(game);

    await expect(
      service.claimControl(
        'org-1',
        'game-1',
        { membershipId: 'member-1' } as never,
        'Statistics device',
      ),
    ).resolves.toEqual(
      expect.objectContaining({ sessionId: 'control-1' }),
    );

    expect(transactionExecute).toHaveBeenCalledTimes(1);
    expect(gameQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(stateQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(controlQuery.forUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('StatisticsService stat-sheet resumption', () => {
  it('reopens a submitted pre-final sheet with an audited reason', async () => {
    const sheetQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'sheet-1',
        status: 'submitted',
      }),
      executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'sheet-1',
        status: 'submitted',
      }),
      forUpdate: jest.fn().mockReturnThis(),
      selectAll: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const updateSet = jest.fn().mockReturnThis();
    const updateQuery = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: updateSet,
      where: jest.fn().mockReturnThis(),
    };
    const auditQuery = {
      execute: jest.fn().mockResolvedValue(undefined),
      values: jest.fn().mockReturnThis(),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn().mockReturnValue(auditQuery),
        selectFrom: jest.fn().mockReturnValue(sheetQuery),
        updateTable: jest.fn().mockReturnValue(updateQuery),
      }),
    );
    const game = {
      away_score: 70,
      away_team_id: 'away-team',
      home_score: 75,
      home_team_id: 'home-team',
      id: 'game-1',
      organization_id: 'org-1',
      status: 'live',
    };
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new StatisticsService(db as never, {} as never);
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue(game);
    jest.spyOn(service as any, 'lockGameForStatistics').mockResolvedValue(game);
    jest
      .spyOn(service as any, 'lockExistingScoringState')
      .mockResolvedValue(undefined);

    await expect(
      service.resume(
        'org-1',
        'game-1',
        { membershipId: 'member-1' } as never,
        'Correct an incorrectly attributed assist.',
      ),
    ).resolves.toEqual({ status: 'reopened' });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciled_at: null,
        reopened_at: expect.any(Date),
        status: 'reopened',
        submitted_at: null,
      }),
    );
    expect(auditQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'statistics.sheet.resumed',
        metadata: expect.objectContaining({
          reason: 'Correct an incorrectly attributed assist.',
        }),
      }),
    );
  });

  it('does not use pre-final resume for a finalized game', async () => {
    const db = {
      transaction: jest.fn(),
    };
    const service = new StatisticsService(db as never, {} as never);
    jest.spyOn(service as any, 'assertGameAccess').mockResolvedValue({
      id: 'game-1',
      status: 'final',
    });

    await expect(
      service.resume(
        'org-1',
        'game-1',
        { membershipId: 'member-1' } as never,
        'Correct an old stat entry.',
      ),
    ).rejects.toThrow(
      'Finalized games require an audited game reopen before statistics can be corrected.',
    );
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
