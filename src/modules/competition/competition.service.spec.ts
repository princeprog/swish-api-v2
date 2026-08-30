import { ConflictException } from '@nestjs/common';
import { CompetitionService } from './competition.service';

const format = {
  crossover_template: [
    { awaySeed: 'B2', homeSeed: 'A1' },
    { awaySeed: 'A2', homeSeed: 'B1' },
  ],
  division_id: 'division-1',
  id: 'format-1',
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
});
