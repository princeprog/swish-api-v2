import { OfficialResultCoordinator } from './official-result.service';

function mutationQuery() {
  return {
    execute: jest.fn().mockResolvedValue([]),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({}),
    set: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

describe('OfficialResultCoordinator', () => {
  const input = {
    access: {
      membershipId: 'member-1',
      organizationId: 'org-1',
      permissions: [],
      role: 'admin',
      userId: 'user-1',
    },
    awayScore: 79,
    gameId: 'game-1',
    homeScore: 82,
    organizationId: 'org-1',
    source: 'scorekeeper' as const,
  };
  const game = {
    away_score: null,
    away_team_id: 'away-team',
    competition_kind: 'stage',
    division_id: 'division-1',
    home_score: null,
    home_team_id: 'home-team',
    id: 'game-1',
    league_season_id: 'season-1',
    matchup_id: 'matchup-1',
    status: 'live',
  };

  it('coordinates result, audit, standings, progression, and notifications once', async () => {
    const update = mutationQuery();
    const insert = mutationQuery();
    const db = {
      insertInto: jest.fn().mockReturnValue(insert),
      updateTable: jest.fn().mockReturnValue(update),
    };
    const service = new OfficialResultCoordinator(
      {} as never,
      { create: jest.fn() } as never,
    );
    jest.spyOn(service as any, 'findGameForUpdate').mockResolvedValue(game);
    jest
      .spyOn(service as any, 'assertRosterAndStatisticsGate')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'rebuildCompetition').mockResolvedValue({
      championTeamId: null,
      standingsRebuilt: true,
    });
    jest
      .spyOn(service as any, 'writeResultNotification')
      .mockResolvedValue(undefined);

    await expect(service.finalizeInTransaction(db, input)).resolves.toEqual({
      alreadyFinalized: false,
      championTeamId: null,
      gameId: 'game-1',
      standingsRebuilt: true,
    });
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        away_score: 79,
        home_score: 82,
        status: 'final',
      }),
    );
    expect(insert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'game.finalized',
        target_id: 'game-1',
      }),
    );
    expect((service as any).rebuildCompetition).toHaveBeenCalledTimes(1);
    expect((service as any).writeResultNotification).toHaveBeenCalledTimes(1);
  });

  it('returns the existing result without repeating official side effects', async () => {
    const db = {
      insertInto: jest.fn(),
      updateTable: jest.fn(),
    };
    const service = new OfficialResultCoordinator(
      {} as never,
      { create: jest.fn() } as never,
    );
    jest.spyOn(service as any, 'findGameForUpdate').mockResolvedValue({
      ...game,
      away_score: 79,
      home_score: 82,
      status: 'final',
    });

    await expect(service.finalizeInTransaction(db, input)).resolves.toEqual({
      alreadyFinalized: true,
      gameId: 'game-1',
    });
    expect(db.updateTable).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
  });
});
