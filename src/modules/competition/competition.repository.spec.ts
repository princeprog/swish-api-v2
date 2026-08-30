import { ConflictException } from '@nestjs/common';
import { CompetitionRepository } from './competition.repository';

function chain(result: unknown) {
  return {
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    select: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

describe('CompetitionRepository generated matchup scheduling', () => {
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
