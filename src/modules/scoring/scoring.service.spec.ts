import { BadRequestException, ConflictException } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { createInitialScoringState } from './scoring-engine';
import { ORGANIZATION_PERMISSIONS } from '../../common/auth/roles';

const game = {
  away_score: null,
  away_team_id: 'away-team',
  away_team_name: 'Away',
  division_name: 'Open',
  division_id: 'division-1',
  home_score: null,
  home_team_id: 'home-team',
  home_team_name: 'Home',
  id: 'game-1',
  league_season_id: 'season-1',
  organization_id: 'org-1',
  starts_at: new Date('2026-08-04T10:00:00.000Z'),
  status: 'scheduled',
  venue_name: 'Main Court',
};

const storedState = {
  away_score: 0,
  away_team_fouls: 0,
  away_timeouts_used: 0,
  current_period_number: 1,
  game_clock_remaining_ms: 600000,
  game_clock_running: false,
  game_clock_started_at: null,
  home_score: 0,
  home_team_fouls: 0,
  home_timeouts_used: 0,
  latest_reversible_event_id: null,
  overtime_duration_ms: 300000,
  overtime_number: 0,
  period_duration_ms: 600000,
  phase: 'pregame',
  regulation_periods: 4,
  shot_clock_enabled: true,
  shot_clock_full_ms: 24000,
  shot_clock_remaining_ms: 24000,
  shot_clock_running: false,
  shot_clock_short_ms: 14000,
  shot_clock_started_at: null,
  team_fouls_before_penalty: 4,
  timeouts_first_half: 2,
  timeouts_per_overtime: 1,
  timeouts_second_half: 3,
  version: 0,
};

const currentSeasonRules = {
  created_at: new Date('2026-08-04T00:00:00.000Z'),
  league_season_id: 'season-1',
  overtime_duration_ms: 180000,
  period_duration_ms: 480000,
  regulation_periods: 6,
  shot_clock_enabled: false,
  shot_clock_full_ms: 30000,
  shot_clock_short_ms: 20000,
  team_fouls_before_penalty: 2,
  timeouts_first_half: 1,
  timeouts_per_overtime: 2,
  timeouts_second_half: 4,
  updated_at: new Date('2026-08-04T00:00:00.000Z'),
};

function chainWithResult(result: unknown) {
  return {
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    forShare: jest.fn().mockReturnThis(),
    forUpdate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

describe('ScoringService season rule snapshots', () => {
  it('refreshes an unstarted game from the latest season rules', async () => {
    const stateQuery = chainWithResult(storedState);
    const rulesQuery = chainWithResult(currentSeasonRules);
    const db = {
      selectFrom: jest.fn((table: string) =>
        table === 'scoring.game_states' ? stateQuery : rulesQuery,
      ),
    };
    const service = new ScoringService(db as never);

    const state = await (service as any).ensureScoringState(game);

    expect(state).toEqual(
      expect.objectContaining({
        gameClockRemainingMs: 480000,
        periodDurationMs: 480000,
        regulationPeriods: 6,
        shotClockEnabled: false,
        teamFoulsBeforePenalty: 2,
        timeoutsFirstHalf: 1,
      }),
    );
    expect(rulesQuery.executeTakeFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored snapshot after a game leaves pregame', async () => {
    const stateQuery = chainWithResult({ ...storedState, phase: 'live' });
    const rulesQuery = chainWithResult(currentSeasonRules);
    const db = {
      selectFrom: jest.fn((table: string) =>
        table === 'scoring.game_states' ? stateQuery : rulesQuery,
      ),
    };
    const service = new ScoringService(db as never);

    const state = await (service as any).ensureScoringState({
      ...game,
      status: 'live',
    });

    expect(state.periodDurationMs).toBe(600000);
    expect(state.shotClockEnabled).toBe(true);
    expect(rulesQuery.executeTakeFirst).not.toHaveBeenCalled();
  });
});

describe('ScoringService parked compliance', () => {
  it('starts the scoring transaction without consulting division requirements', async () => {
    const complianceService = {
      checkGameStartClearance: jest.fn().mockResolvedValue({
        allowed: false,
        blockedTeams: [{ name: 'Away', status: 'pending' }],
      }),
    };
    const transactionExecute = jest
      .fn()
      .mockRejectedValue(new Error('scoring transaction reached'));
    const service = new (ScoringService as any)(
      {
        transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
      },
      undefined,
      complianceService,
    );
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({} as never);

    await expect(
      service.executeCommand('org-1', 'game-1', {} as never, {
        command: { idempotencyKey: 'start-1', type: 'game.start' },
        expectedVersion: 0,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow('scoring transaction reached');

    expect(complianceService.checkGameStartClearance).not.toHaveBeenCalled();
    expect(transactionExecute).toHaveBeenCalledTimes(1);
  });
});

describe('ScoringService official result authorization', () => {
  it('rejects an assigned scorekeeper from reopening an official result', async () => {
    const transactionExecute = jest.fn();
    const coordinator = {
      reopenInTransaction: jest.fn(),
    };
    const service = new ScoringService(
      {
        transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
      } as never,
      undefined,
      coordinator as never,
    );
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue({ ...game, status: 'final' } as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({} as never);

    await expect(
      service.executeCommand(
        'org-1',
        'game-1',
        {
          membershipId: 'member-1',
          organizationId: 'org-1',
          permissions: [ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED],
          role: 'scorekeeper',
          userId: 'user-1',
        },
        {
          command: {
            idempotencyKey: 'reopen-1',
            payload: { reason: 'Correction needed' },
            type: 'game.reopen',
          },
          controlToken: 'control-token',
          expectedVersion: 0,
          occurredAt: new Date(),
        },
      ),
    ).rejects.toThrow(
      'Only authorized league administrators can reopen an official result',
    );

    expect(transactionExecute).not.toHaveBeenCalled();
    expect(coordinator.reopenInTransaction).not.toHaveBeenCalled();
  });
});

describe('ScoringService command boundary', () => {
  it('rejects malformed commands before opening a mutation transaction', async () => {
    const transactionExecute = jest.fn();
    const service = new (ScoringService as any)({
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    });

    await expect(
      service.executeCommand('org-1', 'game-1', {} as never, {
        command: {
          idempotencyKey: 'bad-command',
          payload: { teamId: 'not-a-uuid', points: 2 },
          type: 'score.record',
        },
        expectedVersion: 0,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow(BadRequestException);

    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['expectedVersion', { expectedVersion: -1 }],
    ['occurredAt', { occurredAt: new Date('invalid') }],
    ['controlToken', { controlToken: '   ' }],
  ])(
    'rejects an invalid %s before reading the game',
    async (field, override) => {
      const service = new (ScoringService as any)({
        transaction: jest.fn(),
        selectFrom: jest.fn(),
      });
      const findGame = jest
        .spyOn(service, 'findGameForScoring')
        .mockResolvedValue(game as never);

      await expect(
        service.executeCommand('org-1', 'game-1', {} as never, {
          command: { idempotencyKey: 'command-1', type: 'game.start' },
          expectedVersion: 0,
          occurredAt: new Date(),
          ...override,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(findGame).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, {}])(
    'rejects an empty game configuration before reading the game (%s)',
    async (payload) => {
      const service = new (ScoringService as any)({
        transaction: jest.fn(),
        selectFrom: jest.fn(),
      });
      const findGame = jest
        .spyOn(service, 'findGameForScoring')
        .mockResolvedValue(game as never);

      await expect(
        service.executeCommand('org-1', 'game-1', {} as never, {
          command: {
            idempotencyKey: 'configure-1',
            type: 'game.configure',
            payload,
          },
          expectedVersion: 0,
          occurredAt: new Date(),
        }),
      ).rejects.toThrow(BadRequestException);

      expect(findGame).not.toHaveBeenCalled();
    },
  );
});

describe('ScoringService official lifecycle serialization', () => {
  it('locks the base game before the scoring projection', async () => {
    const calls: string[] = [];
    const lockedGame = { ...game, status: 'scheduled' };
    const query = {
      executeTakeFirst: jest.fn().mockResolvedValue(lockedGame),
      forUpdate: jest.fn().mockImplementation(() => {
        calls.push('forUpdate');
        return query;
      }),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const trx = {
      selectFrom: jest.fn((table: string) => {
        calls.push(table);
        return query;
      }),
    };
    const service = new ScoringService(trx as never);

    await expect(
      (service as any).lockGameForScoring(trx, 'org-1', 'game-1'),
    ).resolves.toEqual(lockedGame);

    expect(calls[0]).toBe('competition.games as games');
    expect(calls[1]).toBe('forUpdate');
    expect(query.where).toHaveBeenCalledWith(
      'games.archived_at',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith(
      'seasons.archived_at',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith(
      'divisions.archived_at',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith(
      'home_teams.archived_at',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith(
      'away_teams.archived_at',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith(
      'venues.archived_at',
      'is',
      null,
    );
    expect(calls).not.toContain('scoring.game_states');
  });

  it('uses the locked game status when a game changed after the access pre-read', async () => {
    const existingEventQuery = chainWithResult(undefined);
    const transactionExecute = jest.fn(async (callback) =>
      callback({ selectFrom: jest.fn().mockReturnValue(existingEventQuery) }),
    );
    const service = new ScoringService({
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    } as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue({ ...game, status: 'scheduled' } as never);
    const assertControlSession = jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({} as never);
    jest
      .spyOn(service as never, 'lockGameForScoring' as never)
      .mockResolvedValue({ ...game, status: 'live' } as never);
    jest
      .spyOn(service as never, 'ensureScoringState' as never)
      .mockResolvedValue({ version: 0 } as never);

    await expect(
      service.executeCommand('org-1', 'game-1', {} as never, {
        command: { idempotencyKey: 'start-after-change', type: 'game.start' },
        controlToken: 'control-token',
        expectedVersion: 0,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow('Only scheduled games can be started');

    expect(transactionExecute).toHaveBeenCalledTimes(1);
    expect(assertControlSession).toHaveBeenCalledWith(
      'game-1',
      expect.anything(),
      'control-token',
      false,
      expect.anything(),
      true,
    );
  });

  it('does not write when the scoring device loses control after the pre-read', async () => {
    const existingEventQuery = chainWithResult(undefined);
    const transactionExecute = jest.fn(async (callback) =>
      callback({ selectFrom: jest.fn().mockReturnValue(existingEventQuery) }),
    );
    const service = new ScoringService({
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    } as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'lockGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'ensureScoringState' as never)
      .mockResolvedValue({ version: 0 } as never);
    const assertControlSession = jest.spyOn(
      service as never,
      'assertControlSession' as never,
    ) as unknown as jest.Mock;
    assertControlSession.mockImplementation(async (...args: any[]) => {
      if (args.length === 6) {
        throw new ConflictException(
          'This scoring device no longer controls the game',
        );
      }
      return {} as never;
    });
    const insertEvent = jest.spyOn(service as never, 'insertEvent' as never);

    await expect(
      service.executeCommand('org-1', 'game-1', {} as never, {
        command: { idempotencyKey: 'lost-control', type: 'clocks.pause' },
        controlToken: 'control-token',
        expectedVersion: 0,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow('This scoring device no longer controls the game');

    expect(assertControlSession).toHaveBeenCalledWith(
      'game-1',
      expect.anything(),
      'control-token',
      false,
      expect.anything(),
      true,
    );
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it('rejects a projection write when the locked version is no longer current', async () => {
    const execute = jest.fn().mockResolvedValue({ numUpdatedRows: 0n });
    const query = {
      execute,
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      updateTable: jest.fn().mockReturnValue(query),
    };
    const service = new ScoringService(db as never);

    await expect(
      (service as any).updateProjection(
        db,
        'game-1',
        {
          awayScore: 1,
          awayTeamFouls: 0,
          awayTimeoutsUsed: 0,
          currentPeriodNumber: 1,
          gameClockRemainingMs: 600000,
          gameClockRunning: false,
          gameClockStartedAt: null,
          homeScore: 2,
          homeTeamFouls: 0,
          homeTimeoutsUsed: 0,
          latestReversibleEvent: null,
          overtimeDurationMs: 300000,
          overtimeNumber: 0,
          periodDurationMs: 600000,
          phase: 'pregame',
          regulationPeriods: 4,
          shotClockEnabled: true,
          shotClockFullMs: 24000,
          shotClockRemainingMs: 24000,
          shotClockRunning: false,
          shotClockShortMs: 14000,
          shotClockStartedAt: null,
          teamFoulsBeforePenalty: 4,
          timeoutsFirstHalf: 2,
          timeoutsPerOvertime: 1,
          timeoutsSecondHalf: 3,
          version: 1,
        },
        'event-1',
        0,
      ),
    ).rejects.toThrow('The scoring state changed. Refresh it and try again.');

    expect(query.where).toHaveBeenCalledWith('version', '=', 0);
  });
});

describe('ScoringService transactional device control', () => {
  it('serializes heartbeat through the game and control transaction', async () => {
    const updateQuery = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
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
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        selectFrom: jest.fn((table: string) =>
          table.startsWith('competition.') ? gameQuery : stateQuery,
        ),
        updateTable: jest.fn().mockReturnValue(updateQuery),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const service = new ScoringService(db as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({
        expires_at: new Date('2026-08-04T10:02:00.000Z'),
        id: 'control-1',
      } as never);

    await expect(
      service.heartbeatControl(
        'org-1',
        'game-1',
        { membershipId: 'member-1' } as never,
        'control-token',
      ),
    ).resolves.toEqual(expect.objectContaining({ sessionId: 'control-1' }));

    expect(transactionExecute).toHaveBeenCalledTimes(1);
  });

  it('locks the active control row when validating a mutation token', async () => {
    const query = chainWithResult({
      control_token_hash: 'hash',
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: 'control-1',
      organization_member_id: 'member-1',
    });
    const db = { selectFrom: jest.fn(() => query) };
    const service = new ScoringService(db as never);
    query.executeTakeFirst.mockResolvedValue({
      control_token_hash: (service as any).hashToken('control-token'),
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: 'control-1',
      organization_member_id: 'member-1',
    });

    await expect(
      (service as any).assertControlSession(
        'game-1',
        { membershipId: 'member-1', permissions: [] },
        'control-token',
        false,
        db,
        true,
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'control-1' }));

    expect(query.forUpdate).toHaveBeenCalledTimes(1);
  });

  it('rejects a heartbeat for an expired control session', async () => {
    const service = new ScoringService({} as never);
    const query = chainWithResult({
      control_token_hash: (service as any).hashToken('control-token'),
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
      id: 'control-1',
      organization_member_id: 'member-1',
    });
    const db = { selectFrom: jest.fn(() => query) };

    await expect(
      (service as any).assertControlSession(
        'game-1',
        { membershipId: 'member-1', permissions: [] },
        'control-token',
        false,
        db,
        true,
      ),
    ).rejects.toThrow('Scoring control expired');
  });

  it('rejects a token held by another device owner', async () => {
    const service = new ScoringService({} as never);
    const query = chainWithResult({
      control_token_hash: (service as any).hashToken('control-token'),
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: 'control-1',
      organization_member_id: 'member-1',
    });
    const db = { selectFrom: jest.fn(() => query) };

    await expect(
      (service as any).assertControlSession(
        'game-1',
        { membershipId: 'member-2', permissions: [] },
        'control-token',
        false,
        db,
        true,
      ),
    ).rejects.toThrow('This device does not control this game');
  });

  it('turns a concurrent claim into one safe conflict inside the lock transaction', async () => {
    const activeControlQuery = chainWithResult({
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: 'control-1',
      organization_member_id: 'member-1',
    });
    const gameQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(game),
      forUpdate: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const stateQuery = chainWithResult(undefined);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn(),
        selectFrom: jest.fn((table: string) =>
          table.startsWith('competition.')
            ? gameQuery
            : table === 'scoring.game_states'
              ? stateQuery
              : activeControlQuery,
        ),
        updateTable: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue({ numUpdatedRows: 0n }),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        }),
      }),
    );
    const service = new ScoringService({
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    } as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);

    await expect(
      service.claimControl(
        'org-1',
        'game-1',
        { membershipId: 'member-2' } as never,
        'Second device',
      ),
    ).rejects.toThrow('Another device is controlling this game');

    expect(transactionExecute).toHaveBeenCalledTimes(1);
  });

  it('releases control only through the ownership transaction', async () => {
    const updateQuery = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const gameQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(game),
      forUpdate: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const stateQuery = chainWithResult(undefined);
    const auditQuery = {
      execute: jest.fn().mockResolvedValue(undefined),
      values: jest.fn().mockReturnThis(),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn().mockReturnValue(auditQuery),
        selectFrom: jest.fn((table: string) =>
          table.startsWith('competition.') ? gameQuery : stateQuery,
        ),
        updateTable: jest.fn().mockReturnValue(updateQuery),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new ScoringService(db as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({ id: 'control-1' } as never);

    await expect(
      service.releaseControl(
        'org-1',
        'game-1',
        { membershipId: 'member-1' } as never,
        'control-token',
      ),
    ).resolves.toEqual({ success: true });

    expect(transactionExecute).toHaveBeenCalledTimes(1);
  });
});

describe('ScoringService historical scoring corrections', () => {
  it('invalidates a submitted stat sheet after an official score correction', async () => {
    const sheetUpdate = {
      execute: jest.fn().mockResolvedValue({ numUpdatedRows: 1n }),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const auditInsert = {
      execute: jest.fn().mockResolvedValue(undefined),
      values: jest.fn().mockReturnThis(),
    };
    const db = {
      insertInto: jest.fn().mockReturnValue(auditInsert),
      updateTable: jest.fn().mockReturnValue(sheetUpdate),
    };
    const service = new ScoringService(db as never);
    const correctedAt = new Date('2026-08-04T12:00:00.000Z');

    await (service as any).invalidateSubmittedStatSheet(
      db,
      'game-1',
      { membershipId: 'member-1', organizationId: 'org-1' },
      correctedAt,
    );

    expect(sheetUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        reconciled_at: null,
        reopened_at: correctedAt,
        status: 'reopened',
        submitted_at: null,
        updated_at: correctedAt,
      }),
    );
    expect(sheetUpdate.where).toHaveBeenCalledWith(
      'status',
      '=',
      'submitted',
    );
    expect(auditInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'statistics.sheet.invalidated',
        target_id: 'game-1',
      }),
    );
  });

  it('loads an older active score event for a reasoned correction', async () => {
    const target = {
      id: 'event-old',
      payload: { points: 2, teamId: 'home-team' },
      reverses_event_id: null,
      type: 'score.record',
    };
    const targetQuery = chainWithResult(target);
    const reversalQuery = chainWithResult(undefined);
    let queryNumber = 0;
    const db = {
      selectFrom: jest.fn(() =>
        queryNumber++ === 0 ? targetQuery : reversalQuery,
      ),
    };
    const service = new ScoringService(db as never);

    const state = await (service as any).prepareReversalState(
      db,
      'game-1',
      {
        latestReversibleEvent: {
          id: 'event-new',
          payload: { points: 3, teamId: 'away-team' },
          summary: 'Away +3',
          type: 'score.record',
        },
      },
      {
        idempotencyKey: 'reverse-old',
        payload: {
          eventId: 'event-old',
          reason: 'Correcting the first basket',
        },
        type: 'event.reverse',
      },
    );

    expect(state.latestReversibleEvent).toEqual(
      expect.objectContaining({ id: 'event-old', type: 'score.record' }),
    );
  });

  it('requires a reason before reversing an older event', async () => {
    const targetQuery = chainWithResult({
      id: 'event-old',
      payload: { points: 2, teamId: 'home-team' },
      reverses_event_id: null,
      type: 'score.record',
    });
    const reversalQuery = chainWithResult(undefined);
    let queryNumber = 0;
    const db = {
      selectFrom: jest.fn(() =>
        queryNumber++ === 0 ? targetQuery : reversalQuery,
      ),
    };
    const service = new ScoringService(db as never);

    await expect(
      (service as any).prepareReversalState(
        db,
        'game-1',
        {
          latestReversibleEvent: {
            id: 'event-new',
            payload: { points: 3, teamId: 'away-team' },
            summary: 'Away +3',
            type: 'score.record',
          },
        },
        {
          idempotencyKey: 'reverse-old-without-reason',
          payload: { eventId: 'event-old' },
          type: 'event.reverse',
        },
      ),
    ).rejects.toThrow('Older corrections require review and a reason');
  });

  it('rejects an event that has already been reversed', async () => {
    const targetQuery = chainWithResult({
      id: 'event-old',
      payload: { points: 2, teamId: 'home-team' },
      reverses_event_id: null,
      type: 'score.record',
    });
    const reversalQuery = chainWithResult({ id: 'event-reversal' });
    let queryNumber = 0;
    const db = {
      selectFrom: jest.fn(() =>
        queryNumber++ === 0 ? targetQuery : reversalQuery,
      ),
    };
    const service = new ScoringService(db as never);

    await expect(
      (service as any).prepareReversalState(
        db,
        'game-1',
        { latestReversibleEvent: null },
        {
          idempotencyKey: 'reverse-twice',
          payload: { eventId: 'event-old', reason: 'Duplicate correction' },
          type: 'event.reverse',
        },
      ),
    ).rejects.toThrow('This scoring event has already been reversed.');
  });

  it('finds the newest active score or foul event after a reversal', async () => {
    const query = {
      execute: jest.fn().mockResolvedValue([
        {
          id: 'event-reversal',
          payload: { eventId: 'event-old' },
          reverses_event_id: 'event-old',
          type: 'event.reverse',
        },
        {
          id: 'event-new',
          payload: { points: 3, teamId: 'away-team' },
          reverses_event_id: null,
          type: 'score.record',
        },
        {
          id: 'event-old',
          payload: { points: 2, teamId: 'home-team' },
          reverses_event_id: null,
          type: 'score.record',
        },
      ]),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = { selectFrom: jest.fn(() => query) };
    const service = new ScoringService(db as never);

    await expect(
      (service as any).findLatestActiveReversibleEvent(db, 'game-1'),
    ).resolves.toEqual(
      expect.objectContaining({ id: 'event-new', type: 'score.record' }),
    );
  });

  it('persists the next active event after correcting an older score', async () => {
    const oldEventId = '00000000-0000-4000-8000-000000000001';
    const nextEventId = '00000000-0000-4000-8000-000000000002';
    const state = {
      ...createInitialScoringState({
        awayTeamId: 'away-team',
        gameId: 'game-1',
        homeTeamId: 'home-team',
      }),
      homeScore: 4,
      latestReversibleEvent: {
        id: oldEventId,
        payload: { points: 2, teamId: 'home-team' },
        summary: 'Home +2',
        type: 'score.record' as const,
      },
      phase: 'reopened' as const,
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        selectFrom: jest.fn().mockReturnValue(chainWithResult(undefined)),
        updateTable: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue({ numUpdatedRows: 0 }),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        }),
      }),
    );
    const service = new ScoringService({
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    } as never);
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue({ ...game, status: 'reopened' } as never);
    jest
      .spyOn(service as never, 'lockGameForScoring' as never)
      .mockResolvedValue({ ...game, status: 'reopened' } as never);
    jest
      .spyOn(service as never, 'ensureScoringState' as never)
      .mockResolvedValue(state as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({} as never);
    jest
      .spyOn(service as never, 'prepareReversalState' as never)
      .mockResolvedValue(state as never);
    jest
      .spyOn(service as never, 'insertEvent' as never)
      .mockResolvedValue({ id: 'reversal-event' } as never);
    jest
      .spyOn(service as never, 'findLatestActiveReversibleEvent' as never)
      .mockResolvedValue({
        id: nextEventId,
        payload: { points: 3, teamId: 'away-team' },
        summary: 'Away +3',
        type: 'score.record',
      } as never);
    const updateProjection = jest
      .spyOn(service as never, 'updateProjection' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'rebuildDetailProjections' as never)
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service as never, 'getControlStatus' as never)
      .mockResolvedValue({ status: 'claimed' } as never);
    jest
      .spyOn(service as never, 'findDetailProjections' as never)
      .mockResolvedValue({} as never);

    const result = await service.executeCommand(
      'org-1',
      'game-1',
      {} as never,
      {
        command: {
          idempotencyKey: 'reverse-old-score',
          payload: {
            eventId: oldEventId,
            reason: 'Correcting the first basket',
          },
          type: 'event.reverse',
        },
        controlToken: 'control-token',
        expectedVersion: 0,
        occurredAt: new Date(),
      },
    );

    expect(updateProjection).toHaveBeenCalledWith(
      expect.anything(),
      'game-1',
      expect.objectContaining({ homeScore: 2 }),
      'reversal-event',
      0,
      nextEventId,
    );
    expect(result.state.latestReversibleEvent).toEqual(
      expect.objectContaining({ id: nextEventId }),
    );
  });
});
