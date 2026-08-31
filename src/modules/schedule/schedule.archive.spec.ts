import { ConflictException } from '@nestjs/common';
import {
  AUTH_ROLES,
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { ScheduleService } from './schedule.service';

function access(): OrganizationAccessContext {
  return {
    membershipId: 'member-admin',
    organizationId: 'org-1',
    permissions: [ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE],
    role: AUTH_ROLES.ADMIN,
    userId: 'user-1',
  };
}

function query<T>(result: T) {
  return {
    execute: jest.fn().mockResolvedValue([]),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    forUpdate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  } as any;
}

function updateQuery<T>(result: T) {
  return {
    execute: jest.fn().mockResolvedValue([]),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    returningAll: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  } as any;
}

function createDb(game: Record<string, unknown>) {
  const gameQuery = query(game);
  const seasonQuery = query({ id: 'season-1' });
  const gameUpdate = updateQuery({ ...game, archived_at: new Date() });
  const matchupUpdate = updateQuery({ id: 'matchup-1', status: 'ready' });
  const auditInsert = {
    execute: jest.fn().mockResolvedValue([]),
    values: jest.fn().mockReturnThis(),
  };
  const trx = {
    insertInto: jest.fn().mockReturnValue(auditInsert),
    selectFrom: jest.fn((table: string) =>
      table === 'admin.league_seasons' ? seasonQuery : gameQuery,
    ),
    updateTable: jest
      .fn()
      .mockReturnValueOnce(gameUpdate)
      .mockReturnValueOnce(matchupUpdate),
  };
  const db = {
    transaction: jest.fn().mockReturnValue({
      execute: jest.fn((callback: (value: unknown) => unknown) =>
        callback(trx),
      ),
    }),
  };

  return { auditInsert, db, gameUpdate, matchupUpdate, seasonQuery, trx };
}

describe('ScheduleService archival', () => {
  it('archives an unstarted generated game and returns its matchup to ready', async () => {
    const { auditInsert, db, gameUpdate, matchupUpdate } = createDb({
      archived_at: null,
      away_score: null,
      finalized_at: null,
      home_score: null,
      id: 'game-1',
      matchup_id: 'matchup-1',
      status: 'scheduled',
    });
    const service = new ScheduleService(db as never);

    await service.archive('org-1', 'game-1', access());

    expect(gameUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ archived_at: expect.any(Date) }),
    );
    expect(matchupUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready' }),
    );
    expect(auditInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'game.archived',
        actor_member_id: 'member-admin',
        target_id: 'game-1',
      }),
    );
  });

  it('does not archive a live or reopened game', async () => {
    const { db, gameUpdate } = createDb({
      archived_at: null,
      away_score: 4,
      finalized_at: null,
      home_score: 6,
      id: 'game-1',
      matchup_id: null,
      status: 'live',
    });
    const service = new ScheduleService(db as never);

    await expect(
      service.archive('org-1', 'game-1', access()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(gameUpdate.set).not.toHaveBeenCalled();
  });

  it('only restores a game while its season is active', async () => {
    const { db, seasonQuery } = createDb({
      archived_at: new Date('2026-08-31T00:00:00.000Z'),
      away_score: null,
      finalized_at: null,
      home_score: null,
      id: 'game-1',
      matchup_id: null,
      status: 'scheduled',
    });
    const service = new ScheduleService(db as never);

    await service.restore('org-1', 'game-1', access());

    expect(seasonQuery.where).toHaveBeenCalledWith(
      'archived_at',
      'is',
      null,
    );
  });
});
