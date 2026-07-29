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
  const updateSet = jest.fn().mockReturnThis();
  const updateExecuteTakeFirstOrThrow = jest.fn().mockResolvedValue({});
  const updateChain = {
    executeTakeFirstOrThrow: updateExecuteTakeFirstOrThrow,
    set: updateSet,
    where: jest.fn().mockReturnThis(),
  };

  return {
    db: {
      selectFrom: jest.fn().mockReturnValue(selectChain),
      updateTable: jest.fn().mockReturnValue(updateChain),
    },
    executeTakeFirst,
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
});

describe('ScheduleService list filters', () => {
  it('applies schedule filters and sorting in the database query', async () => {
    const { db } = createDbMock();
    const service = new ScheduleService(db as never);

    await service.findAll('org-1', {
      divisionId: 'division-1',
      search: 'cebu',
      sortBy: 'division',
      status: 'scheduled',
    });

    const query = db.selectFrom.mock.results[0].value;
    expect(query.where).toHaveBeenCalledWith('organization_id', '=', 'org-1');
    expect(query.where).toHaveBeenCalledWith('division_id', '=', 'division-1');
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

    await expect(service.findOne('org-1', 'game-2', access)).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
