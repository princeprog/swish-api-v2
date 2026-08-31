import {
  OfficialResultCoordinator,
  type FinalizeOfficialResultInput,
} from './official-result.service';

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
  const input: FinalizeOfficialResultInput = {
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

  it('blocks reopening when a dependent playoff game has already started', async () => {
    const source = {
      away_source_ref: 'team-b',
      away_source_type: 'team',
      away_team_id: 'away-team',
      division_format_id: 'format-1',
      home_source_ref: 'team-a',
      home_source_type: 'team',
      home_team_id: 'home-team',
      id: 'matchup-1',
      loser_to_matchup_id: null,
      stage: 'playoff',
      winner_to_matchup_id: 'matchup-2',
    };
    const dependent = {
      ...source,
      id: 'matchup-2',
      loser_to_matchup_id: null,
      winner_to_matchup_id: null,
    };
    let matchupQueryCount = 0;
    const db = {
      selectFrom: jest.fn((table: string) => {
        const query = {
          execute: jest.fn(),
          executeTakeFirst: jest.fn(),
          forUpdate: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          selectAll: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        };
        if (table === 'competition.matchups') {
          matchupQueryCount += 1;
          if (matchupQueryCount === 1) {
            query.executeTakeFirst.mockResolvedValue(source);
          } else {
            query.execute.mockResolvedValue([source, dependent]);
          }
        } else {
          query.execute.mockResolvedValue([
            { id: 'game-2', matchup_id: 'matchup-2', status: 'live' },
          ]);
        }
        return query;
      }),
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

    await expect(
      service.reopenInTransaction(db, {
        access: input.access,
        gameId: game.id,
        organizationId: input.organizationId,
        reason: 'The official score needs correction.',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DEPENDENT_PLAYOFF_GAMES_STARTED',
        downstreamGames: [
          expect.objectContaining({ gameId: 'game-2', status: 'live' }),
        ],
      }),
    });
  });

  it('returns scheduled dependent games to the scheduling queue when reopening', async () => {
    const source = {
      away_source_ref: 'team-b',
      away_source_type: 'team',
      away_team_id: 'away-team',
      division_format_id: 'format-1',
      home_source_ref: 'team-a',
      home_source_type: 'team',
      home_team_id: 'home-team',
      id: 'matchup-1',
      loser_to_matchup_id: null,
      stage: 'playoff',
      winner_to_matchup_id: 'matchup-2',
    };
    const dependent = {
      ...source,
      id: 'matchup-2',
      loser_to_matchup_id: null,
      winner_to_matchup_id: null,
    };
    let matchupQueryCount = 0;
    const mutation = mutationQuery();
    const deletion = mutationQuery();
    const db = {
      deleteFrom: jest.fn().mockReturnValue(deletion),
      insertInto: jest.fn().mockReturnValue(mutation),
      selectFrom: jest.fn((table: string) => {
        const query = {
          execute: jest.fn(),
          executeTakeFirst: jest.fn(),
          forUpdate: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          selectAll: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
        };
        if (table === 'competition.matchups') {
          matchupQueryCount += 1;
          if (matchupQueryCount === 1)
            query.executeTakeFirst.mockResolvedValue(source);
          else query.execute.mockResolvedValue([source, dependent]);
        } else if (table === 'competition.games') {
          query.execute.mockResolvedValue([
            { id: 'game-2', matchup_id: 'matchup-2', status: 'scheduled' },
          ]);
        } else {
          query.executeTakeFirst.mockResolvedValue({
            id: 'format-1',
            status: 'locked',
          });
        }
        return query;
      }),
      updateTable: jest.fn().mockReturnValue(mutation),
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
    jest
      .spyOn(service as any, 'resetMatchupsAfterReopen')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'rebuildPoolStandings')
      .mockResolvedValue(undefined);

    await expect(
      service.reopenInTransaction(db, {
        access: input.access,
        gameId: game.id,
        organizationId: input.organizationId,
        reason: 'The official score needs correction.',
      }),
    ).resolves.toEqual({
      gameId: 'game-1',
      unscheduledGameIds: ['game-2'],
    });
    expect(db.deleteFrom).toHaveBeenCalledWith('competition.games');
    expect(mutation.values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'game.reopened',
        metadata: expect.objectContaining({
          unscheduledDownstreamGameIds: ['game-2'],
        }),
      }),
    );
  });
});
