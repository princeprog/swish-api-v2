import { ConflictException } from '@nestjs/common';
import { CompetitionRepository } from './competition.repository';

function chain(result: unknown) {
  return {
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    execute: jest.fn().mockResolvedValue([]),
    forUpdate: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

describe('CompetitionRepository format mutation serialization', () => {
  it('bumps the format revision when draft defaults change', async () => {
    const formatUpdate = chain({ id: 'format-1', revision: 2 }) as any;
    formatUpdate.returningAll = jest.fn().mockReturnThis();
    const poolsQuery = chain([]);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        deleteFrom: jest.fn().mockReturnValue(chain(undefined)),
        insertInto: jest.fn().mockReturnValue(chain(undefined)),
        selectFrom: jest.fn().mockReturnValue(poolsQuery),
        updateTable: jest.fn().mockReturnValue(formatUpdate),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const repository = new CompetitionRepository(db as never);

    await repository.updateFormat('format-1', {});

    expect(formatUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ revision: expect.anything() }),
    );
  });

  it('locks the format before replacing pool assignments', async () => {
    const formatQuery = chain({ id: 'format-1', status: 'draft' });
    const deletion = chain(undefined);
    const insertion = chain(undefined);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        deleteFrom: jest.fn().mockReturnValue(deletion),
        insertInto: jest.fn().mockReturnValue({
          execute: insertion.execute,
          values: jest.fn().mockReturnThis(),
        }),
        selectFrom: jest.fn().mockReturnValue(formatQuery),
        updateTable: jest.fn().mockReturnValue(formatQuery),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const repository = new CompetitionRepository(db as never);

    await repository.setPoolAssignments(
      ['pool-1'],
      [{ poolId: 'pool-1', teamIds: ['team-1'] }],
      'format-1',
    );

    expect(formatQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(formatQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({ revision: expect.anything() }),
    );
    expect(deletion.execute).toHaveBeenCalledTimes(1);
    expect(insertion.execute).toHaveBeenCalledTimes(1);
  });

  it('voids the current generated graph instead of deleting its matchups on reset', async () => {
    const formatQuery = chain({ id: 'format-1', revision: 3, status: 'locked' });
    const gamesQuery = chain(undefined);
    const matchupsUpdate = chain({ numUpdatedRows: 2n });
    const mutation = chain(undefined);
    const deletedTables: string[] = [];
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        deleteFrom: jest.fn((table: string) => {
          deletedTables.push(table);
          return mutation;
        }),
        selectFrom: jest.fn((table: string) =>
          table === 'competition.division_formats'
            ? formatQuery
            : gamesQuery,
        ),
        updateTable: jest.fn((table: string) =>
          table === 'competition.matchups' ? matchupsUpdate : mutation,
        ),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const repository = new CompetitionRepository(db as never);

    await expect(repository.reset('format-1')).resolves.toEqual({
      success: true,
    });

    expect(formatQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(matchupsUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'void' }),
    );
    expect(deletedTables).toEqual([
      'competition.standings_projections',
      'competition.tie_decisions',
    ]);
    expect(deletedTables).not.toContain('competition.matchups');
  });
});

describe('CompetitionRepository generated matchup scheduling', () => {
  it('requires the generated plan to use the current format revision', async () => {
    const formatUpdate = chain({ id: 'format-1' });
    const matchupsQuery = chain([]);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        selectFrom: jest.fn().mockReturnValue(matchupsQuery),
        updateTable: jest.fn().mockReturnValue(formatUpdate),
      }),
    );
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const repository = new CompetitionRepository(db as never);

    await repository.lockAndInsertMatchups(
      {
        id: 'format-1',
        revision: 3,
      } as never,
      [],
    );

    expect(formatUpdate.where).toHaveBeenCalledWith('revision', '=', 3);
  });

  it('requires the game to link to the matchup before transitioning it', async () => {
    const gameQuery = chain(undefined);
    const updateQuery = chain({ numUpdatedRows: 1n });
    const db = {
      selectFrom: jest.fn().mockReturnValue(gameQuery),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const repository = new CompetitionRepository(db as never);

    await expect(
      repository.markMatchupScheduled('matchup-1', 'game-1'),
    ).rejects.toThrow(ConflictException);
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('marks exactly one ready matchup after verifying the game link', async () => {
    const gameQuery = chain({ id: 'game-1', matchup_id: 'matchup-1' });
    const updateQuery = chain({ numUpdatedRows: 1n });
    const db = {
      selectFrom: jest.fn().mockReturnValue(gameQuery),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const repository = new CompetitionRepository(db as never);

    await expect(
      repository.markMatchupScheduled('matchup-1', 'game-1'),
    ).resolves.toBeUndefined();
    expect(updateQuery.where).toHaveBeenCalledWith('id', '=', 'matchup-1');
    expect(updateQuery.where).toHaveBeenCalledWith('status', '=', 'ready');
  });
});
