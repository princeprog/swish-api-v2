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

  it('records a tie decision through one transaction boundary', async () => {
    const transaction = jest
      .fn()
      .mockImplementation(async (callback) => callback({}));
    const db = {
      transaction: jest.fn().mockReturnValue({ execute: transaction }),
    };
    const service = new OfficialResultCoordinator(
      db as never,
      { create: jest.fn() } as never,
    );
    const tieInput = {
      access: input.access,
      divisionId: 'division-1',
      expectedStandingsRevision: 3,
      orderedTeamIds: ['team-b', 'team-a'],
      organizationId: 'org-1',
      poolId: 'pool-1',
      reason: 'The league committee confirmed the published order.',
      teamIds: ['team-a', 'team-b'],
    };
    const inTransaction = jest
      .spyOn(service as any, 'recordTieDecisionInTransaction')
      .mockResolvedValue({ decision: { id: 'decision-1' } });

    await expect((service as any).recordTieDecision(tieInput)).resolves.toEqual(
      { decision: { id: 'decision-1' } },
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(inTransaction).toHaveBeenCalledWith({}, tieInput);
  });

  it('resolves only the requested unresolved tie group', async () => {
    const teamA = 'c0a80121-0000-4000-8000-000000000011';
    const teamB = 'c0a80121-0000-4000-8000-000000000012';
    const teamC = 'c0a80121-0000-4000-8000-000000000013';
    const teamD = 'c0a80121-0000-4000-8000-000000000014';
    const format = {
      crossover_template: [],
      division_id: 'division-1',
      division_name: 'Open',
      id: 'format-1',
      league_season_id: 'season-1',
      playoff_format: 'none',
      pool_count: 1,
      qualifiers_per_pool: 2,
      qualifying_format: 'single_round_robin',
      revision: 1,
      schedule_slot_duration_minutes: 90,
      status: 'locked',
      tiebreakers: ['win_percentage', 'manual_decision'],
    };
    const rows = [
      {
        pool_id: 'pool-1',
        rank: null,
        team_id: teamA,
        version: 4,
        unresolved_tie_key: [teamA, teamB].sort().join('|'),
      },
      {
        pool_id: 'pool-1',
        rank: null,
        team_id: teamB,
        version: 4,
        unresolved_tie_key: [teamA, teamB].sort().join('|'),
      },
      {
        pool_id: 'pool-1',
        rank: null,
        team_id: teamC,
        version: 4,
        unresolved_tie_key: [teamC, teamD].sort().join('|'),
      },
      {
        pool_id: 'pool-1',
        rank: null,
        team_id: teamD,
        version: 4,
        unresolved_tie_key: [teamC, teamD].sort().join('|'),
      },
    ];
    const selectQuery = (table: string) => {
      const query: Record<string, jest.Mock> = {
        execute: jest
          .fn()
          .mockResolvedValue(
            table === 'competition.standings_projections' ? rows : [],
          ),
        executeTakeFirst: jest.fn().mockResolvedValue(
          table === 'competition.division_formats as formats'
            ? format
            : table === 'competition.games as games'
              ? {
                  away_score: 70,
                  away_team_id: teamB,
                  competition_kind: 'stage',
                  division_id: 'division-1',
                  home_score: 75,
                  home_team_id: teamA,
                  id: 'game-1',
                  league_season_id: 'season-1',
                  matchup_id: 'matchup-1',
                  status: 'final',
                }
              : undefined,
        ),
      };
      for (const method of [
        'forUpdate',
        'innerJoin',
        'orderBy',
        'select',
        'selectAll',
        'where',
      ]) {
        query[method] = jest.fn().mockReturnValue(query);
      }
      return query;
    };
    const decisionMutation = {
      execute: jest.fn().mockResolvedValue([]),
      executeTakeFirstOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'decision-1' }),
      onConflict: jest.fn().mockImplementation((callback) => {
        const conflict = {
          columns: jest.fn().mockReturnThis(),
          doUpdateSet: jest.fn().mockReturnThis(),
        };
        callback(conflict);
        return decisionMutation;
      }),
      returningAll: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
    };
    const auditMutation = {
      execute: jest.fn().mockResolvedValue([]),
      values: jest.fn().mockReturnThis(),
    };
    const db = {
      insertInto: jest.fn((table: string) =>
        table === 'competition.tie_decisions'
          ? decisionMutation
          : auditMutation,
      ),
      selectFrom: jest.fn(selectQuery),
    };
    const service = new OfficialResultCoordinator(
      {} as never,
      { create: jest.fn() } as never,
    );
    const rebuild = jest
      .spyOn(service as any, 'rebuildPoolStandings')
      .mockResolvedValue(undefined);

    await expect(
      (service as any).recordTieDecisionInTransaction(db, {
        access: input.access,
        divisionId: 'division-1',
        expectedStandingsRevision: 4,
        orderedTeamIds: [teamB, teamA],
        organizationId: 'org-1',
        poolId: 'pool-1',
        reason: 'The league committee confirmed the published order.',
        teamIds: [teamA, teamB],
      }),
    ).resolves.toMatchObject({ decision: { id: 'decision-1' } });
    expect(rebuild).toHaveBeenCalledTimes(1);
    const formatQuery = db.selectFrom.mock.results[0].value;
    expect(formatQuery.where).toHaveBeenCalledWith(
      'divisions.archived_at',
      'is',
      null,
    );
    expect(formatQuery.where).toHaveBeenCalledWith(
      'seasons.archived_at',
      'is',
      null,
    );
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

  it('locks official results only for games with active parent records', async () => {
    const gameQuery = {
      executeTakeFirst: jest.fn().mockResolvedValue(game),
      forUpdate: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const service = new OfficialResultCoordinator(
      { selectFrom: jest.fn().mockReturnValue(gameQuery) } as never,
      { create: jest.fn() } as never,
    );

    await (service as any).findGameForUpdate(
      (service as any).db,
      input,
    );

    expect(gameQuery.where).toHaveBeenCalledWith(
      'seasons.archived_at',
      'is',
      null,
    );
    expect(gameQuery.where).toHaveBeenCalledWith(
      'divisions.archived_at',
      'is',
      null,
    );
    expect(gameQuery.where).toHaveBeenCalledWith(
      'venues.archived_at',
      'is',
      null,
    );
    expect(gameQuery.where).toHaveBeenCalledWith(
      'home_teams.archived_at',
      'is',
      null,
    );
    expect(gameQuery.where).toHaveBeenCalledWith(
      'away_teams.archived_at',
      'is',
      null,
    );
  });
});
