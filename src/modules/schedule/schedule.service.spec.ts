import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_ROLES,
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { ScheduleService } from './schedule.service';

function createDbMock() {
  const executeTakeFirst = jest.fn().mockResolvedValue({
    away_team_id: 'team-b',
    created_at: new Date('2026-07-09T00:00:00.000Z'),
    division_id: 'division-1',
    finalized_at: null,
    away_score: null,
    home_score: null,
    home_team_id: 'team-a',
    competition_kind: 'exhibition',
    matchup_id: null,
    id: 'game-1',
    league_season_id: 'season-1',
    published_at: null,
    starts_at: new Date('2026-07-09T10:00:00.000Z'),
    status: 'scheduled',
    updated_at: new Date('2026-07-09T00:00:00.000Z'),
    venue_id: 'venue-1',
  });
  const selectChain = {
    execute: jest.fn().mockResolvedValue([]),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    executeTakeFirst,
  };
  const scoringStateExecuteTakeFirst = jest.fn().mockResolvedValue(undefined);
  const scoringStateSelectChain = {
    executeTakeFirst: scoringStateExecuteTakeFirst,
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
  const updateSet = jest.fn().mockReturnThis();
  const updateExecuteTakeFirstOrThrow = jest.fn().mockResolvedValue({});
  const updateChain = {
    executeTakeFirstOrThrow: updateExecuteTakeFirstOrThrow,
    set: updateSet,
    where: jest.fn().mockReturnThis(),
  };
  const deleteExecute = jest.fn().mockResolvedValue([]);
  const deleteChain = {
    execute: deleteExecute,
    where: jest.fn().mockReturnThis(),
  };

  return {
    db: {
      deleteFrom: jest.fn().mockReturnValue(deleteChain),
      selectFrom: jest.fn((table: string) =>
        table === 'scoring.game_states' ? scoringStateSelectChain : selectChain,
      ),
      updateTable: jest.fn().mockReturnValue(updateChain),
    },
    executeTakeFirst,
    deleteExecute,
    scoringStateExecuteTakeFirst,
    updateExecuteTakeFirstOrThrow,
    updateSet,
  };
}

function createOrganizationAccessContext(
  overrides: Partial<OrganizationAccessContext> = {},
): OrganizationAccessContext {
  return {
    membershipId: 'membership-1',
    organizationId: 'org-1',
    permissions: [ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED],
    role: AUTH_ROLES.SCOREKEEPER,
    userId: 'user-1',
    ...overrides,
  };
}

function createExpressionBuilderMock() {
  const assignedGamesSubquery = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    whereRef: jest.fn().mockReturnThis(),
  };
  const expressionBuilder = Object.assign(
    jest.fn((left: string, operator: string, right: string) => ({
      left,
      operator,
      right,
    })),
    {
      exists: jest.fn((query) => ({ kind: 'exists', query })),
      or: jest.fn((expressions) => ({ kind: 'or', expressions })),
      selectFrom: jest.fn().mockReturnValue(assignedGamesSubquery),
    },
  );

  return {
    assignedGamesSubquery,
    expressionBuilder,
  };
}

describe('ScheduleService final score updates', () => {
  const gameRecord = (overrides: Record<string, unknown> = {}) => ({
    away_score: null,
    away_team_id: 'team-b',
    competition_kind: 'exhibition',
    created_at: new Date('2026-07-09T00:00:00.000Z'),
    division_id: 'division-1',
    finalized_at: null,
    home_score: null,
    home_team_id: 'team-a',
    id: 'game-1',
    league_season_id: 'season-1',
    matchup_id: null,
    published_at: null,
    starts_at: new Date('2026-07-09T10:00:00.000Z'),
    status: 'scheduled',
    updated_at: new Date('2026-07-09T00:00:00.000Z'),
    venue_id: 'venue-1',
    ...overrides,
  });

  it.each([
    ['live', { status: 'live' }],
    ['reopened', { status: 'reopened' }],
    ['scored', { home_score: 12 }],
    ['finalized', { finalized_at: new Date('2026-07-09T12:00:00.000Z') }],
    ['generated', { matchup_id: 'matchup-1' }],
  ])(
    'rejects generic edits to %s games before any update',
    async (_, overrides) => {
      const { db, executeTakeFirst, updateExecuteTakeFirstOrThrow } =
        createDbMock();
      executeTakeFirst.mockResolvedValueOnce(gameRecord(overrides));
      const service = new ScheduleService(db as never);

      await expect(
        service.update('org-1', 'game-1', {
          startsAt: '2026-07-10T10:00:00.000Z',
        }),
      ).rejects.toThrow(
        'Use the competition or scoring workflow to change this game.',
      );
      expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
    },
  );

  it('updates an unscored, unlinked exhibition game before game action starts', async () => {
    const { db, executeTakeFirst, updateExecuteTakeFirstOrThrow } =
      createDbMock();
    executeTakeFirst.mockResolvedValueOnce(
      gameRecord({ competition_kind: 'exhibition' }),
    );
    const service = new ScheduleService(db as never);

    await service.update('org-1', 'game-1', {
      startsAt: '2026-07-10T10:00:00.000Z',
      status: 'postponed',
    });
    expect(updateExecuteTakeFirstOrThrow).toHaveBeenCalled();
  });

  it.each(['live', 'reopened'])(
    'rejects incoming %s status before any update',
    async (status) => {
      const { db, updateExecuteTakeFirstOrThrow } = createDbMock();
      const service = new ScheduleService(db as never);

      await expect(
        service.update('org-1', 'game-1', { status: status as any }),
      ).rejects.toThrow(
        'Only draft, scheduled, postponed, or cancelled games can be changed here.',
      );
      expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
    },
  );

  it('rejects official statuses on generic game creation', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);

    await expect(
      service.create('org-1', createOrganizationAccessContext(), {
        awayTeamId: 'team-b',
        divisionId: 'division-1',
        homeTeamId: 'team-a',
        leagueSeasonId: 'season-1',
        startsAt: '2026-07-10T10:00:00.000Z',
        status: 'final' as any,
        venueId: 'venue-1',
      }),
    ).rejects.toThrow('New games can only be drafts or scheduled games.');
  });

  it('does not allow generic updates to write official-result fields', async () => {
    const { db, updateSet } = createDbMock();
    const service = new ScheduleService(db as never);

    await service.update('org-1', 'game-1', {
      startsAt: '2026-07-10T10:00:00.000Z',
      status: 'draft',
      ...({
        homeScore: 82,
        awayScore: 79,
        matchupId: 'matchup-1',
        competitionKind: 'playoff',
        leagueSeasonId: 'season-2',
        divisionId: 'division-2',
        homeTeamId: 'team-c',
        awayTeamId: 'team-d',
      } as any),
    });

    const updateValues = updateSet.mock.calls[0][0];
    for (const field of [
      'away_score',
      'competition_kind',
      'division_id',
      'home_score',
      'home_team_id',
      'league_season_id',
      'matchup_id',
    ]) {
      expect(updateValues).not.toHaveProperty(field);
    }
  });

  it('rejects final status without both scores', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        homeScore: 82,
        status: 'final' as any,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes official results through the dedicated finalization endpoint', async () => {
    const { db, updateSet } = createDbMock();
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        awayScore: 79,
        homeScore: 82,
        status: 'final' as any,
      } as any),
    ).rejects.toThrow(
      'Use Finalize game to record an official result and update standings.',
    );
    expect(updateSet).not.toHaveBeenCalled();
  });

  it('rejects direct result changes after scoring state exists', async () => {
    const { db, scoringStateExecuteTakeFirst } = createDbMock();
    scoringStateExecuteTakeFirst.mockResolvedValueOnce({ game_id: 'game-1' });
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        awayScore: 79,
        homeScore: 82,
        status: 'final' as any,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ScheduleService finalized game protection', () => {
  it('rejects schedule edits after a game is final', async () => {
    const { db, executeTakeFirst, updateExecuteTakeFirstOrThrow } =
      createDbMock();
    executeTakeFirst.mockResolvedValueOnce({
      away_score: 79,
      away_team_id: 'team-b',
      created_at: new Date('2026-07-09T00:00:00.000Z'),
      division_id: 'division-1',
      finalized_at: new Date('2026-07-09T12:00:00.000Z'),
      home_score: 82,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      published_at: new Date('2026-07-09T00:00:00.000Z'),
      starts_at: new Date('2026-07-09T10:00:00.000Z'),
      status: 'final',
      updated_at: new Date('2026-07-09T12:00:00.000Z'),
      venue_id: 'venue-1',
    });
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        startsAt: '2026-07-10T10:00:00.000Z',
      }),
    ).rejects.toThrow(
      'Use the competition or scoring workflow to change this game.',
    );
    expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
  });

  it('rejects deleting finalized games', async () => {
    const { db, executeTakeFirst, deleteExecute } = createDbMock();
    executeTakeFirst.mockResolvedValueOnce({
      away_score: 79,
      away_team_id: 'team-b',
      created_at: new Date('2026-07-09T00:00:00.000Z'),
      division_id: 'division-1',
      finalized_at: new Date('2026-07-09T12:00:00.000Z'),
      home_score: 82,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      published_at: new Date('2026-07-09T00:00:00.000Z'),
      starts_at: new Date('2026-07-09T10:00:00.000Z'),
      status: 'final',
      updated_at: new Date('2026-07-09T12:00:00.000Z'),
      venue_id: 'venue-1',
    });
    const service = new ScheduleService(db as never);

    await expect(service.remove('org-1', 'game-1')).rejects.toThrow(
      'This record cannot be deleted. Archive support is being prepared so league history remains available.',
    );
    expect(deleteExecute).not.toHaveBeenCalled();
  });
});

describe('ScheduleService manual finalization', () => {
  it('finalizes a scheduled game with an official non-tied score', async () => {
    const { db } = createDbMock();
    const officialResultCoordinator = {
      finalize: jest.fn().mockResolvedValue({ alreadyFinalized: false }),
    };
    const service = new ScheduleService(
      db as never,
      undefined,
      officialResultCoordinator as never,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({
      away_score: 79,
      home_score: 82,
      id: 'game-1',
      status: 'final',
    });
    const access = createOrganizationAccessContext({
      permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
      role: AUTH_ROLES.ADMIN,
    });

    await service.finalizeManually('org-1', 'game-1', access, {
      awayScore: 79,
      homeScore: 82,
    });

    expect(officialResultCoordinator.finalize).toHaveBeenCalledWith({
      access,
      awayScore: 79,
      gameId: 'game-1',
      homeScore: 82,
      organizationId: 'org-1',
      source: 'manual',
    });
  });

  it('rejects tied manual final scores', async () => {
    const { db, updateExecuteTakeFirstOrThrow } = createDbMock();
    const service = new ScheduleService(db as never);

    await expect(
      service.finalizeManually(
        'org-1',
        'game-1',
        createOrganizationAccessContext(),
        {
          awayScore: 80,
          homeScore: 80,
        },
      ),
    ).rejects.toThrow(
      'Basketball games need a winning team before they can be finalized.',
    );
    expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
  });

  it('rejects games that are not scheduled', async () => {
    const { db, executeTakeFirst, updateExecuteTakeFirstOrThrow } =
      createDbMock();
    executeTakeFirst.mockResolvedValueOnce({
      away_score: null,
      away_team_id: 'team-b',
      created_at: new Date('2026-07-09T00:00:00.000Z'),
      division_id: 'division-1',
      finalized_at: null,
      home_score: null,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      published_at: null,
      starts_at: new Date('2026-07-09T10:00:00.000Z'),
      status: 'live',
      updated_at: new Date('2026-07-09T00:00:00.000Z'),
      venue_id: 'venue-1',
    });
    const service = new ScheduleService(db as never);

    await expect(
      service.finalizeManually(
        'org-1',
        'game-1',
        createOrganizationAccessContext(),
        {
          awayScore: 79,
          homeScore: 82,
        },
      ),
    ).rejects.toThrow('Only scheduled games can be finalized from Schedules.');
    expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
  });

  it('rejects games with scorekeeper activity', async () => {
    const { db, scoringStateExecuteTakeFirst, updateExecuteTakeFirstOrThrow } =
      createDbMock();
    scoringStateExecuteTakeFirst.mockResolvedValueOnce({ game_id: 'game-1' });
    const service = new ScheduleService(db as never);

    await expect(
      service.finalizeManually(
        'org-1',
        'game-1',
        createOrganizationAccessContext(),
        {
          awayScore: 79,
          homeScore: 82,
        },
      ),
    ).rejects.toThrow(
      'This game already has scoring activity. Use the scorekeeper console to finish it.',
    );
    expect(updateExecuteTakeFirstOrThrow).not.toHaveBeenCalled();
  });
});

describe('ScheduleService list filters', () => {
  it('applies schedule filters and sorting in the database query', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);

    await service.findAll('org-1', {
      divisionId: 'division-1',
      leagueSeasonId: 'season-1',
      search: 'cebu',
      sortBy: 'division',
      status: 'scheduled',
    });

    const query = db.selectFrom.mock.results[0].value;
    expect(query.where).toHaveBeenCalledWith('organization_id', '=', 'org-1');
    expect(query.where).toHaveBeenCalledWith('division_id', '=', 'division-1');
    expect(query.where).toHaveBeenCalledWith(
      'league_season_id',
      '=',
      'season-1',
    );
    expect(query.where).toHaveBeenCalledWith('status', '=', 'scheduled');
    expect(query.where).toHaveBeenCalledWith(expect.any(Function));
    expect(query.orderBy).toHaveBeenCalledWith('division_name asc');
    expect(query.orderBy).toHaveBeenCalledWith('starts_at asc');
  });
});

describe('ScheduleService assigned game access', () => {
  it('scopes scorekeeper list queries to games assigned to their membership', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);
    const access = createOrganizationAccessContext();

    await service.findAll('org-1', access);

    const query = db.selectFrom.mock.results[0].value;
    const scopeCallback = query.where.mock.calls.find(
      ([argument]) => typeof argument === 'function',
    )?.[0];
    const { assignedGamesSubquery, expressionBuilder } =
      createExpressionBuilderMock();

    scopeCallback(expressionBuilder);

    expect(expressionBuilder.selectFrom).toHaveBeenCalledWith(
      'access.game_scorekeeper_assignments as assigned_games',
    );
    expect(assignedGamesSubquery.where).toHaveBeenCalledWith(
      'assigned_games.organization_member_id',
      '=',
      'membership-1',
    );
    expect(assignedGamesSubquery.whereRef).toHaveBeenCalledWith(
      'assigned_games.game_id',
      '=',
      'admin.schedule_games.id',
    );
  });

  it('uses the same scorekeeper assignment scope when retrieving one assigned game', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);
    const access = createOrganizationAccessContext();

    await service.findOne('org-1', 'game-1', access);

    const query = db.selectFrom.mock.results[0].value;
    expect(query.where).toHaveBeenCalledWith('organization_id', '=', 'org-1');
    expect(query.where).toHaveBeenCalledWith('id', '=', 'game-1');

    const scopeCallback = query.where.mock.calls.find(
      ([argument]) => typeof argument === 'function',
    )?.[0];
    const { assignedGamesSubquery, expressionBuilder } =
      createExpressionBuilderMock();

    scopeCallback(expressionBuilder);

    expect(assignedGamesSubquery.where).toHaveBeenCalledWith(
      'assigned_games.organization_member_id',
      '=',
      'membership-1',
    );
    expect(assignedGamesSubquery.whereRef).toHaveBeenCalledWith(
      'assigned_games.game_id',
      '=',
      'admin.schedule_games.id',
    );
  });

  it('returns not found when an unassigned game is outside the scorekeeper scope', async () => {
    const { db, executeTakeFirst } = createDbMock();
    executeTakeFirst.mockResolvedValueOnce(undefined);
    const service = new ScheduleService(db as never);
    const access = createOrganizationAccessContext();

    await expect(
      service.findOne('org-1', 'game-2', access),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps owner and admin game reads organization-wide', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);
    const adminAccess = createOrganizationAccessContext({
      permissions: [
        ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED,
        ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
      ],
      role: AUTH_ROLES.ADMIN,
    });

    await service.findAll('org-1', adminAccess);

    const query = db.selectFrom.mock.results[0].value;
    expect(query.where).not.toHaveBeenCalledWith(expect.any(Function));
  });
});

describe('ScheduleService schedule mutex', () => {
  it('locks the season row before schedule conflict checks', async () => {
    const forUpdate = jest.fn().mockReturnThis();
    const executeTakeFirst = jest.fn().mockResolvedValue({
      id: 'season-1',
      schedule_slot_duration_minutes: 90,
    });
    const query = {
      executeTakeFirst,
      forUpdate,
      select: jest.fn().mockReturnThis(),
      selectFrom: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new ScheduleService({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await expect(
      service.lockSeasonForScheduling(query, 'org-1', 'season-1'),
    ).resolves.toMatchObject({ id: 'season-1' });
    expect(forUpdate).toHaveBeenCalledTimes(1);
    expect(executeTakeFirst).toHaveBeenCalledTimes(1);
  });

  it('checks current staff assignments when a scheduled game is rescheduled', async () => {
    const query = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'season-1',
        schedule_slot_duration_minutes: 90,
      }),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const trx = {
      selectFrom: jest.fn().mockReturnValue(query),
      updateTable: jest.fn().mockReturnValue({
        executeTakeFirstOrThrow: jest.fn().mockResolvedValue({}),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      }),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const service = new ScheduleService(db as never);
    const game = {
      away_score: null,
      away_team_id: 'team-b',
      competition_kind: 'exhibition',
      created_at: new Date(),
      division_id: 'division-1',
      finalized_at: null,
      home_score: null,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      matchup_id: null,
      published_at: new Date(),
      starts_at: new Date('2026-09-01T11:00:00.000Z'),
      status: 'scheduled',
      updated_at: new Date(),
      venue_id: 'venue-1',
    };
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue(game);
    jest.spyOn(service as any, 'findGameAssignments').mockResolvedValue({
      scorekeeperMemberId: 'member-scorekeeper-1',
      statisticianMemberId: 'member-statistician-1',
    });
    jest
      .spyOn(service as any, 'assertGenericUpdateIsAllowed')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'assertScheduleRelations')
      .mockResolvedValue(undefined);
    const conflictCheck = jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'game-1' });

    await service.update('org-1', 'game-1', {
      status: 'scheduled',
    });

    expect(conflictCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        scorekeeperMemberId: 'member-scorekeeper-1',
        statisticianMemberId: 'member-statistician-1',
        startsAt: new Date('2026-09-01T11:00:00.000Z'),
      }),
      trx,
      90,
    );
  });

  it('uses the post-lock game state for generic update guards', async () => {
    const query = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'season-1',
        schedule_slot_duration_minutes: 90,
      }),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const trx = {
      selectFrom: jest.fn().mockReturnValue(query),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const service = new ScheduleService(db as never);
    const lockedGame = {
      away_score: null,
      away_team_id: 'team-b',
      competition_kind: 'exhibition',
      created_at: new Date(),
      division_id: 'division-1',
      finalized_at: null,
      home_score: null,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      matchup_id: null,
      published_at: new Date(),
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'live',
      updated_at: new Date(),
      venue_id: 'venue-1',
    };
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue(lockedGame);

    await expect(
      service.update('org-1', 'game-1', {
        startsAt: '2026-09-01T11:00:00.000Z',
      }),
    ).rejects.toThrow(
      'Use the competition or scoring workflow to change this game.',
    );
  });

  it('uses the post-lock game state for assignment guards', async () => {
    const query = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'season-1',
        schedule_slot_duration_minutes: 90,
      }),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const trx = { selectFrom: jest.fn().mockReturnValue(query) };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'live',
      venue_id: 'venue-1',
    });

    await expect(
      service.updateScorekeeperAssignment(
        'org-1',
        'game-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        { scorekeeperMemberId: 'member-scorekeeper-1' },
      ),
    ).rejects.toThrow(
      'Scorekeeper assignments lock after the game begins. Reopen this only before game day action starts.',
    );
  });

  it('uses the post-lock game state for statistician assignment guards', async () => {
    const query = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        id: 'season-1',
        schedule_slot_duration_minutes: 90,
      }),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const trx = { selectFrom: jest.fn().mockReturnValue(query) };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'live',
      venue_id: 'venue-1',
    });

    await expect(
      service.updateStatisticianAssignment(
        'org-1',
        'game-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        { statisticianMemberId: 'member-statistician-1' },
      ),
    ).rejects.toThrow(
      'Scorekeeper assignments lock after the game begins. Reopen this only before game day action starts.',
    );
  });
});

describe('ScheduleService scorekeeper assignments', () => {
  it('keeps an idempotent scorekeeper assignment without replacing or notifying', async () => {
    const assignmentQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        organization_member_id: 'member-scorekeeper-1',
      }),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const transactionContext = {
      selectFrom: jest.fn().mockReturnValue(assignmentQuery),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(transactionContext)),
      }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'lockSeasonForScheduling').mockResolvedValue({
      schedule_slot_duration_minutes: 90,
    });
    jest.spyOn(service as any, 'lockGameForScheduling').mockResolvedValue({
      id: 'game-1',
    });
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'scheduled',
      venue_id: 'venue-1',
    });
    const eligibility = jest
      .spyOn(service as any, 'assertScorekeeperCanBeAssigned')
      .mockResolvedValue(undefined);
    const conflict = jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    const replace = jest
      .spyOn(service as any, 'replaceScorekeeperAssignmentInTransaction')
      .mockResolvedValue(undefined);
    const audit = jest
      .spyOn(service as any, 'writeAuditInTransaction')
      .mockResolvedValue(undefined);
    const notify = jest
      .spyOn(service as any, 'notifyScorekeeperAssignment')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'game-1' });

    await service.updateScorekeeperAssignment(
      'org-1',
      'game-1',
      createOrganizationAccessContext({
        permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
        role: AUTH_ROLES.ADMIN,
      }),
      { scorekeeperMemberId: 'member-scorekeeper-1' },
    );

    expect(eligibility).toHaveBeenCalledWith(
      transactionContext,
      'org-1',
      'member-scorekeeper-1',
    );
    expect(conflict).toHaveBeenCalledWith(
      expect.objectContaining({
        scorekeeperMemberId: 'member-scorekeeper-1',
      }),
      transactionContext,
      90,
    );
    expect(assignmentQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('rolls back a scorekeeper assignment when the audit write fails', async () => {
    const assignmentQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      forUpdate: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const transactionContext = {
      selectFrom: jest.fn().mockReturnValue(assignmentQuery),
    };
    const transactionExecute = jest.fn(async (callback) =>
      callback(transactionContext),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'lockSeasonForScheduling').mockResolvedValue({
      schedule_slot_duration_minutes: 90,
    });
    jest.spyOn(service as any, 'lockGameForScheduling').mockResolvedValue({
      id: 'game-1',
    });
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'scheduled',
      venue_id: 'venue-1',
    });
    jest
      .spyOn(service as any, 'assertScorekeeperCanBeAssigned')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'replaceScorekeeperAssignmentInTransaction')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'writeAuditInTransaction')
      .mockRejectedValue(new Error('audit unavailable'));
    const notify = jest
      .spyOn(service as any, 'notifyScorekeeperAssignment')
      .mockResolvedValue(undefined);

    await expect(
      service.updateScorekeeperAssignment(
        'org-1',
        'game-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        { scorekeeperMemberId: 'member-scorekeeper-1' },
      ),
    ).rejects.toThrow('audit unavailable');

    expect(transactionExecute).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('does not report an assignment failure when post-commit notification delivery fails', async () => {
    const assignmentQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const transactionContext = {
      selectFrom: jest.fn().mockReturnValue(assignmentQuery),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(transactionContext)),
      }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'lockSeasonForScheduling').mockResolvedValue({
      schedule_slot_duration_minutes: 90,
    });
    jest.spyOn(service as any, 'lockGameForScheduling').mockResolvedValue({
      id: 'game-1',
    });
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'scheduled',
      venue_id: 'venue-1',
    });
    jest
      .spyOn(service as any, 'assertScorekeeperCanBeAssigned')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'replaceScorekeeperAssignmentInTransaction')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'writeAuditInTransaction')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'notifyScorekeeperAssignment')
      .mockRejectedValue(new Error('notification provider unavailable'));
    jest
      .spyOn(service, 'findOne')
      .mockRejectedValue(new Error('read unavailable'));

    await expect(
      service.updateScorekeeperAssignment(
        'org-1',
        'game-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        { scorekeeperMemberId: 'member-scorekeeper-1' },
      ),
    ).resolves.toEqual({ id: 'game-1' });
  });

  it('returns a committed game when create-assignment enrichment or notifications fail', async () => {
    const service = new ScheduleService({} as never);
    const inserted = { id: 'game-1' };
    jest
      .spyOn(service, 'findOne')
      .mockRejectedValue(new Error('read unavailable'));
    jest
      .spyOn(service as any, 'notifyGameRecipients')
      .mockRejectedValue(new Error('notification provider unavailable'));
    jest
      .spyOn(service as any, 'notifyScorekeeperAssignment')
      .mockRejectedValue(new Error('notification provider unavailable'));

    await expect(
      (service as any).finishCreatedGame(
        'org-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        {
          scorekeeperMemberId: 'member-scorekeeper-1',
          status: 'scheduled',
        },
        inserted,
      ),
    ).resolves.toEqual(inserted);
  });

  it('creates a game and scorekeeper assignment in one transaction', async () => {
    const insertInto = jest
      .fn()
      .mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockReturnThis(),
        executeTakeFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'game-1',
        }),
      })
      .mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue([]),
      });
    let transactionContext: any;
    const transactionExecute = jest.fn(async (callback) => {
      transactionContext = {
        selectFrom: db.selectFrom,
        deleteFrom: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue([]),
          where: jest.fn().mockReturnThis(),
        }),
        insertInto,
      };
      return callback(transactionContext);
    });
    const db = {
      insertInto: jest.fn(),
      selectFrom: jest.fn().mockReturnValue({
        executeTakeFirst: jest.fn().mockResolvedValue({ id: 'related-1' }),
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        selectAll: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      }),
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new ScheduleService(db as never);
    const conflictCheck = jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'game-1' });

    await service.create(
      'org-1',
      createOrganizationAccessContext({
        permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
        role: AUTH_ROLES.ADMIN,
      }),
      {
        awayTeamId: 'team-b',
        divisionId: 'division-1',
        homeTeamId: 'team-a',
        leagueSeasonId: 'season-1',
        scorekeeperMemberId: 'member-scorekeeper-1',
        startsAt: '2026-07-09T10:00:00.000Z',
        status: 'scheduled',
        venueId: 'venue-1',
      },
    );

    expect(db.transaction).toHaveBeenCalled();
    expect(conflictCheck).toHaveBeenCalledWith(
      {
        awayTeamId: 'team-b',
        homeTeamId: 'team-a',
        leagueSeasonId: 'season-1',
        scorekeeperMemberId: 'member-scorekeeper-1',
        startsAt: new Date('2026-07-09T10:00:00.000Z'),
        statisticianMemberId: undefined,
        venueId: 'venue-1',
      },
      expect.anything(),
      undefined,
    );
    expect(conflictCheck.mock.calls[0][1]).toBe(transactionContext);
    expect(transactionExecute).toHaveBeenCalled();
    expect(insertInto).toHaveBeenCalledWith('competition.games');
    expect(insertInto).toHaveBeenCalledWith(
      'access.game_scorekeeper_assignments',
    );
    expect(insertInto).toHaveBeenCalledWith('access.audit_events');
  });

  it('lists active scorekeepers for schedule assignment', async () => {
    const execute = jest.fn().mockResolvedValue([
      {
        email: 'scorekeeper@example.com',
        id: 'member-scorekeeper-1',
        name: 'Sam Scorekeeper',
      },
    ]);
    const selectChain = {
      execute,
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new ScheduleService({
      selectFrom: jest.fn().mockReturnValue(selectChain),
    } as never);

    await expect(service.findEligibleScorekeepers('org-1')).resolves.toEqual([
      {
        email: 'scorekeeper@example.com',
        id: 'member-scorekeeper-1',
        name: 'Sam Scorekeeper',
      },
    ]);

    expect(selectChain.where).toHaveBeenCalledWith(
      'members.organization_id',
      '=',
      'org-1',
    );
    expect(selectChain.where).toHaveBeenCalledWith(
      'members.role',
      '=',
      AUTH_ROLES.SCOREKEEPER,
    );
    expect(selectChain.where).toHaveBeenCalledWith(
      'members.status',
      '=',
      'active',
    );
  });

  it('blocks scorekeeper changes after the game begins', async () => {
    const { db, executeTakeFirst } = createDbMock();
    executeTakeFirst.mockResolvedValueOnce({
      away_score: null,
      away_team_id: 'team-b',
      created_at: new Date('2026-07-09T00:00:00.000Z'),
      division_id: 'division-1',
      finalized_at: null,
      home_score: null,
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      published_at: null,
      starts_at: new Date('2026-07-09T10:00:00.000Z'),
      status: 'live',
      updated_at: new Date('2026-07-09T00:00:00.000Z'),
      venue_id: 'venue-1',
    });
    const service = new ScheduleService(db as never);

    await expect(
      service.updateScorekeeperAssignment(
        'org-1',
        'game-1',
        createOrganizationAccessContext({
          permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
          role: AUTH_ROLES.ADMIN,
        }),
        { scorekeeperMemberId: 'member-scorekeeper-1' },
      ),
    ).rejects.toThrow(
      'Scorekeeper assignments lock after the game begins. Reopen this only before game day action starts.',
    );
  });
});

describe('ScheduleService statistician assignments', () => {
  it('keeps an idempotent statistician assignment without replacing or auditing', async () => {
    const assignmentQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue({
        organization_member_id: 'member-statistician-1',
      }),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const transactionContext = {
      selectFrom: jest.fn().mockReturnValue(assignmentQuery),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(transactionContext)),
      }),
    };
    const service = new ScheduleService(db as never);
    jest
      .spyOn(service as any, 'findGameSeasonId')
      .mockResolvedValue('season-1');
    jest.spyOn(service as any, 'lockSeasonForScheduling').mockResolvedValue({
      schedule_slot_duration_minutes: 90,
    });
    jest.spyOn(service as any, 'lockGameForScheduling').mockResolvedValue({
      id: 'game-1',
    });
    jest.spyOn(service as any, 'findGameRecord').mockResolvedValue({
      away_team_id: 'team-b',
      division_id: 'division-1',
      home_team_id: 'team-a',
      id: 'game-1',
      league_season_id: 'season-1',
      starts_at: new Date('2026-09-01T10:00:00.000Z'),
      status: 'scheduled',
      venue_id: 'venue-1',
    });
    const eligibility = jest
      .spyOn(service as any, 'assertStatisticianCanBeAssigned')
      .mockResolvedValue(undefined);
    const conflict = jest
      .spyOn(service as any, 'assertNoScheduleConflict')
      .mockResolvedValue(undefined);
    const deleteFrom = jest.fn();
    const insertInto = jest.fn();
    Object.assign(transactionContext, { deleteFrom, insertInto });
    const audit = jest
      .spyOn(service as any, 'writeAuditInTransaction')
      .mockResolvedValue(undefined);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'game-1' });

    await service.updateStatisticianAssignment(
      'org-1',
      'game-1',
      createOrganizationAccessContext({
        permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
        role: AUTH_ROLES.ADMIN,
      }),
      { statisticianMemberId: 'member-statistician-1' },
    );

    expect(eligibility).toHaveBeenCalledWith(
      'org-1',
      'member-statistician-1',
      transactionContext,
    );
    expect(conflict).toHaveBeenCalledWith(
      expect.objectContaining({
        statisticianMemberId: 'member-statistician-1',
      }),
      transactionContext,
      90,
    );
    expect(deleteFrom).not.toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('lists active statisticians separately from scorekeepers', async () => {
    const execute = jest.fn().mockResolvedValue([
      {
        email: 'stats@example.com',
        id: 'member-statistician-1',
        name: 'Pat Statistician',
      },
    ]);
    const selectChain = {
      execute,
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new ScheduleService({
      selectFrom: jest.fn().mockReturnValue(selectChain),
    } as never);

    await expect(
      service.findEligibleStatisticians('org-1'),
    ).resolves.toHaveLength(1);
    expect(selectChain.where).toHaveBeenCalledWith(
      'members.role',
      '=',
      AUTH_ROLES.STATISTICIAN,
    );
  });
});
