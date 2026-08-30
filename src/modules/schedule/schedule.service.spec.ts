import { BadRequestException, NotFoundException } from '@nestjs/common';
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
  it('rejects final status without both scores', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        homeScore: 82,
        status: 'final',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets finalized_at when final status has both scores', async () => {
    const { db, updateSet } = createDbMock();
    const service = new ScheduleService(db as never);

    await service.update('org-1', 'game-1', {
      awayScore: 79,
      homeScore: 82,
      status: 'final',
    });

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        away_score: 79,
        finalized_at: expect.any(Date),
        home_score: 82,
        status: 'final',
      }),
    );
  });

  it('rejects direct result changes after scoring state exists', async () => {
    const { db, scoringStateExecuteTakeFirst } = createDbMock();
    scoringStateExecuteTakeFirst.mockResolvedValueOnce({ game_id: 'game-1' });
    const service = new ScheduleService(db as never);

    await expect(
      service.update('org-1', 'game-1', {
        awayScore: 79,
        homeScore: 82,
        status: 'final',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
    ).rejects.toThrow('This game is final and can no longer be edited.');
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
      'Finalized games cannot be deleted because they are part of the official league record.',
    );
    expect(deleteExecute).not.toHaveBeenCalled();
  });
});

describe('ScheduleService manual finalization', () => {
  it('finalizes a scheduled game with an official non-tied score', async () => {
    const { db, updateSet } = createDbMock();
    const auditInsertValues = jest.fn().mockReturnThis();
    const auditInsertExecute = jest.fn().mockResolvedValue([]);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn().mockReturnValue({
          execute: auditInsertExecute,
          values: auditInsertValues,
        }),
        updateTable: db.updateTable,
      }),
    );
    (db as any).transaction = jest
      .fn()
      .mockReturnValue({ execute: transactionExecute });
    const service = new ScheduleService(db as never);
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

    expect(transactionExecute).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        away_score: 79,
        finalized_at: expect.any(Date),
        home_score: 82,
        status: 'final',
        updated_at: expect.any(Date),
      }),
    );
    expect(auditInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'game.manually_finalized',
        metadata: {
          awayScore: 79,
          homeScore: 82,
          previousStatus: 'scheduled',
        },
        target_id: 'game-1',
        target_type: 'game',
      }),
    );
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

describe('ScheduleService scorekeeper assignments', () => {
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
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        deleteFrom: jest.fn().mockReturnValue({
          execute: jest.fn().mockResolvedValue([]),
          where: jest.fn().mockReturnThis(),
        }),
        insertInto,
      }),
    );
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
    expect(conflictCheck).toHaveBeenCalledWith({
      awayTeamId: 'team-b',
      homeTeamId: 'team-a',
      leagueSeasonId: 'season-1',
      startsAt: new Date('2026-07-09T10:00:00.000Z'),
      venueId: 'venue-1',
    });
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

    await expect(service.findEligibleStatisticians('org-1')).resolves.toHaveLength(
      1,
    );
    expect(selectChain.where).toHaveBeenCalledWith(
      'members.role',
      '=',
      AUTH_ROLES.STATISTICIAN,
    );
  });
});
