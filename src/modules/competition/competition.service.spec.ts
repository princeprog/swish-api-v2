import { ConflictException } from '@nestjs/common';
import { CompetitionService } from './competition.service';

const format = {
  crossover_template: [
    { awaySeed: 'B2', homeSeed: 'A1' },
    { awaySeed: 'A2', homeSeed: 'B1' },
  ],
  division_id: 'division-1',
  id: 'format-1',
  league_season_id: 'season-1',
  playoff_format: 'single_elimination',
  pool_count: 2,
  qualifiers_per_pool: 2,
  qualifying_format: 'single_round_robin',
  revision: 1,
  status: 'draft',
  tiebreakers: ['win_percentage', 'manual_decision'],
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    findFormatContext: jest.fn().mockResolvedValue(format),
    findMatchup: jest.fn().mockResolvedValue({
      away_team_id: 'team-b',
      home_team_id: 'team-a',
      id: 'matchup-1',
      stage: 'qualifier',
      status: 'ready',
    }),
    getWorkspace: jest.fn().mockResolvedValue({ format, pools: [] }),
    listDivisionTeamIds: jest
      .fn()
      .mockResolvedValue(['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4']),
    listMatchups: jest.fn().mockResolvedValue([{ id: 'existing-matchup' }]),
    listPoolsWithTeams: jest.fn().mockResolvedValue([
      { code: 'A', id: 'pool-a', teamIds: ['A1', 'A2', 'A3', 'A4'] },
      { code: 'B', id: 'pool-b', teamIds: ['B1', 'B2', 'B3', 'B4'] },
    ]),
    lockAndInsertMatchups: jest
      .fn()
      .mockResolvedValue([{ id: 'generated-matchup' }]),
    reset: jest.fn().mockResolvedValue({ success: true }),
    recordTieDecision: jest.fn().mockResolvedValue({ id: 'decision-1' }),
    markMatchupScheduled: jest.fn().mockResolvedValue(undefined),
    lockFormatForScheduling: jest.fn().mockResolvedValue({
      ...format,
      status: 'locked',
    }),
    lockMatchupForScheduling: jest.fn().mockResolvedValue({
      away_team_id: 'team-b',
      home_team_id: 'team-a',
      id: 'matchup-1',
      stage: 'qualifier',
      status: 'ready',
      format_revision: 1,
    }),
    markMatchupScheduledInTransaction: jest.fn().mockResolvedValue(undefined),
    setPoolAssignments: jest.fn().mockResolvedValue(undefined),
    updateFormat: jest.fn().mockResolvedValue(format),
    ...overrides,
  };
}

describe('CompetitionService', () => {
  it('generates and locks one plan for a draft format', async () => {
    const repo = repository();
    const service = new CompetitionService(repo as never);

    const result = await service.generate('org-1', 'division-1', {});

    expect(result).toEqual({
      formatRevision: 1,
      matchups: [{ id: 'generated-matchup' }],
      status: 'locked',
    });
    expect(repo.lockAndInsertMatchups).toHaveBeenCalledTimes(1);
    expect(repo.lockAndInsertMatchups.mock.calls[0][1]).toHaveLength(15);
  });

  it('returns the existing revision when generation is repeated', async () => {
    const repo = repository({
      findFormatContext: jest.fn().mockResolvedValue({
        ...format,
        status: 'locked',
      }),
    });
    const service = new CompetitionService(repo as never);

    await expect(
      service.generate('org-1', 'division-1', {}),
    ).resolves.toEqual({
      formatRevision: 1,
      matchups: [{ id: 'existing-matchup' }],
      status: 'locked',
    });
    expect(repo.lockAndInsertMatchups).not.toHaveBeenCalled();
  });

  it('blocks generation until every division team has one pool', async () => {
    const repo = repository({
      listPoolsWithTeams: jest.fn().mockResolvedValue([
        { code: 'A', id: 'pool-a', teamIds: ['A1'] },
        { code: 'B', id: 'pool-b', teamIds: ['B1'] },
      ]),
    });
    const service = new CompetitionService(repo as never);

    await expect(
      service.generate('org-1', 'division-1', {}),
    ).rejects.toThrow(
      'Assign every division team to exactly one pool before generating matchups.',
    );
  });

  it('keeps format changes restricted to drafts', async () => {
    const repo = repository({
      findFormatContext: jest.fn().mockResolvedValue({
        ...format,
        status: 'locked',
      }),
    });
    const service = new CompetitionService(repo as never);

    await expect(
      service.updateFormat('org-1', 'division-1', {
        playoffFormat: 'double_elimination',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.updateFormat).not.toHaveBeenCalled();
  });

  it('schedules a ready matchup and links the resulting game', async () => {
    const repo = repository();
    const scheduleService = {
      createCompetitionGame: jest.fn().mockResolvedValue({ id: 'game-1', status: 'scheduled' }),
      createCompetitionGameInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'game-1', status: 'scheduled' }),
      completeCompetitionGame: jest
        .fn()
        .mockResolvedValue({ id: 'game-1', status: 'scheduled' }),
    };
    const trx = {};
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn(async (callback: (trx: unknown) => unknown) =>
          callback(trx),
        ),
      }),
    };
    const service = new CompetitionService(
      repo as never,
      scheduleService as never,
      undefined,
      db as never,
    );
    const access = {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: [],
      role: 'admin' as const,
      userId: 'user-1',
    };

    await expect(
      service.scheduleMatchup('org-1', 'division-1', 'matchup-1', access, {
        startsAt: '2026-09-01T10:00:00.000Z',
        statisticianMemberId: 'c0a80121-0000-4000-8000-000000000099',
        venueId: 'c0a80121-0000-4000-8000-000000000001',
      }),
    ).resolves.toEqual({ id: 'game-1', status: 'scheduled' });
    expect(scheduleService.createCompetitionGameInTransaction).toHaveBeenCalledWith(
      'org-1',
      access,
      expect.objectContaining({
        awayTeamId: 'team-b',
        competitionKind: 'stage',
        divisionId: 'division-1',
        homeTeamId: 'team-a',
        leagueSeasonId: 'season-1',
        matchupId: 'matchup-1',
        status: 'scheduled',
        statisticianMemberId: 'c0a80121-0000-4000-8000-000000000099',
      }),
      trx,
    );
    expect(repo.markMatchupScheduledInTransaction).toHaveBeenCalledWith(
      'matchup-1',
      'game-1',
      trx,
    );
  });

  it('rolls back the transaction when the matchup transition fails', async () => {
    const repo = repository({
      markMatchupScheduledInTransaction: jest
        .fn()
        .mockRejectedValue(new ConflictException('transition failed')),
    });
    const scheduleService = {
      createCompetitionGameInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'game-1', status: 'scheduled' }),
    };
    const rollback = new Error('transition failed');
    const execute = jest.fn(async (callback: (trx: unknown) => unknown) => {
      try {
        return await callback({});
      } catch (error) {
        expect(error).toBe(rollback);
        throw error;
      }
    });
    (repo.markMatchupScheduledInTransaction as jest.Mock).mockRejectedValueOnce(
      rollback,
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute }),
    };
    const service = new CompetitionService(
      repo as never,
      scheduleService as never,
      undefined,
      db as never,
    );
    const access = {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: [],
      role: 'admin' as const,
      userId: 'user-1',
    };

    await expect(
      service.scheduleMatchup('org-1', 'division-1', 'matchup-1', access, {
        startsAt: '2026-09-01T10:00:00.000Z',
        venueId: 'c0a80121-0000-4000-8000-000000000001',
      }),
    ).rejects.toBe(rollback);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(scheduleService.createCompetitionGameInTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not create a second game when the locked matchup is no longer ready', async () => {
    const repo = repository({
      lockMatchupForScheduling: jest.fn().mockResolvedValue({
        away_team_id: 'team-b',
        home_team_id: 'team-a',
        id: 'matchup-1',
        stage: 'qualifier',
        status: 'scheduled',
        format_revision: 1,
      }),
    });
    const scheduleService = {
      createCompetitionGameInTransaction: jest.fn(),
      completeCompetitionGame: jest.fn(),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn(async (callback: (trx: unknown) => unknown) =>
          callback({}),
        ),
      }),
    };
    const service = new CompetitionService(
      repo as never,
      scheduleService as never,
      undefined,
      db as never,
    );
    const access = {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: [],
      role: 'admin' as const,
      userId: 'user-1',
    };

    await expect(
      service.scheduleMatchup('org-1', 'division-1', 'matchup-1', access, {
        startsAt: '2026-09-01T10:00:00.000Z',
        venueId: 'c0a80121-0000-4000-8000-000000000001',
      }),
    ).rejects.toThrow('already been scheduled');
    expect(scheduleService.createCompetitionGameInTransaction).not.toHaveBeenCalled();
  });

  it('records an audited unresolved tie order and recalculates qualification', async () => {
    const teamA = 'c0a80121-0000-4000-8000-000000000011';
    const teamB = 'c0a80121-0000-4000-8000-000000000012';
    const repo = repository({
      findFormatContext: jest.fn().mockResolvedValue({
        ...format,
        status: 'locked',
      }),
      getWorkspace: jest.fn().mockResolvedValue({
        format: { ...format, status: 'locked' },
        pools: [{ id: 'c0a80121-0000-4000-8000-000000000001' }],
        standings: [
          { pool_id: 'c0a80121-0000-4000-8000-000000000001', rank: null, team_id: teamA },
          { pool_id: 'c0a80121-0000-4000-8000-000000000001', rank: null, team_id: teamB },
        ],
      }),
    });
    const coordinator = { recalculateDivision: jest.fn().mockResolvedValue({ success: true }) };
    const service = new CompetitionService(
      repo as never,
      undefined,
      coordinator as never,
    );
    const access = {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: [],
      role: 'admin' as const,
      userId: 'user-1',
    };

    await service.recordTieDecision('org-1', 'division-1', access, {
      orderedTeamIds: [teamB, teamA],
      poolId: 'c0a80121-0000-4000-8000-000000000001',
      reason: 'The league committee confirmed the published order.',
      teamIds: [teamA, teamB],
    });

    expect(repo.recordTieDecision).toHaveBeenCalledWith(
      'format-1',
      'c0a80121-0000-4000-8000-000000000001',
      `${teamA}|${teamB}`,
      [teamA, teamB],
      [teamB, teamA],
      'The league committee confirmed the published order.',
      access,
    );
    expect(coordinator.recalculateDivision).toHaveBeenCalledWith(
      'org-1',
      'division-1',
      access,
    );
  });
});
