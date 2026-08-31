import { includePublicHistoryGame, PublicService } from './public.service';

describe('includePublicHistoryGame', () => {
  it('keeps finalized history while hiding archived operational games', () => {
    expect(
      includePublicHistoryGame({ archived_at: new Date(), status: 'final' }),
    ).toBe(true);
    expect(
      includePublicHistoryGame({ archived_at: new Date(), status: 'scheduled' }),
    ).toBe(false);
    expect(includePublicHistoryGame({ archived_at: null, status: 'live' })).toBe(
      true,
    );
  });
});

function createDatabaseMock(rows: unknown[]) {
  const builder = {
    execute: jest.fn().mockResolvedValue(rows),
    orderBy: jest.fn(),
    selectAll: jest.fn(),
    selectFrom: jest.fn(),
    where: jest.fn(),
  };

  builder.selectFrom.mockReturnValue(builder);
  builder.selectAll.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);

  return builder;
}

describe('PublicService', () => {
  it('maps public organization data without leaking private fields', async () => {
    const db = createDatabaseMock([
      {
        organization_id: 'org-1',
        organization_name: 'Swish League',
        organization_slug: 'swish-league',
        season_id: 'season-1',
        season_name: 'Season 1',
        season_slug: 'season-1',
      },
    ]);

    const service = new PublicService(db as never);

    await expect(service.getOrganization('swish-league')).resolves.toEqual({
      id: 'org-1',
      name: 'Swish League',
      seasons: [
        {
          id: 'season-1',
          name: 'Season 1',
          slug: 'season-1',
        },
      ],
      slug: 'swish-league',
    });
  });

  it('maps public league shell data into nested divisions, teams, and rosters', async () => {
    const db = createDatabaseMock([
      {
        division_id: 'division-1',
        division_name: 'Seniors',
        division_slug: 'seniors',
        organization_id: 'org-1',
        organization_name: 'Swish League',
        organization_slug: 'swish-league',
        player_id: 'player-1',
        player_jersey_number: '23',
        player_name: 'Jordan Cruz',
        season_id: 'season-1',
        season_name: 'Season 1',
        season_slug: 'season-1',
        team_color: '#123456',
        team_id: 'team-1',
        team_name: 'Falcons',
        team_slug: 'falcons',
      },
    ]);

    const service = new PublicService(db as never);

    await expect(
      service.getLeagueShell('swish-league', 'season-1'),
    ).resolves.toEqual({
      divisions: [
        {
          id: 'division-1',
          name: 'Seniors',
          slug: 'seniors',
          teams: [
            {
              color: '#123456',
              id: 'team-1',
              name: 'Falcons',
              players: [
                {
                  id: 'player-1',
                  jerseyNumber: '23',
                  name: 'Jordan Cruz',
                },
              ],
              slug: 'falcons',
            },
          ],
        },
      ],
      organization: {
        id: 'org-1',
        name: 'Swish League',
        slug: 'swish-league',
      },
      season: {
        id: 'season-1',
        name: 'Season 1',
        slug: 'season-1',
      },
    });
  });

  it('publishes live scores as unofficial and separates finalized results', async () => {
    const query = (rows: unknown[], first?: unknown) => ({
      execute: jest.fn().mockResolvedValue(rows),
      executeTakeFirst: jest.fn().mockResolvedValue(first),
      groupBy: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    });
    const games = [
      {
        away_score: 70,
        away_team_id: 'team-b',
        away_team_name: 'Bears',
        competition_kind: 'stage',
        division_id: 'division-1',
        division_name: 'Seniors',
        home_score: 72,
        home_team_id: 'team-a',
        home_team_name: 'Aces',
        id: 'live-game',
        starts_at: new Date('2026-09-01T10:00:00.000Z'),
        status: 'live',
        venue_name: 'Main Court',
      },
      {
        away_score: 79,
        away_team_id: 'team-d',
        away_team_name: 'Dragons',
        competition_kind: 'playoff',
        division_id: 'division-1',
        division_name: 'Seniors',
        home_score: 82,
        home_team_id: 'team-c',
        home_team_name: 'Comets',
        id: 'final-game',
        starts_at: new Date('2026-09-01T12:00:00.000Z'),
        status: 'final',
        venue_name: 'Main Court',
      },
    ];
    const db = {
      selectFrom: jest.fn((table: string) =>
        table.startsWith('admin.league_seasons')
          ? query([], { id: 'season-1' })
          : table.startsWith('competition.games')
            ? query(games)
            : query([]),
      ),
    };
    const service = new PublicService(db as never);
    jest.spyOn(service, 'getLeagueShell').mockResolvedValue({
      divisions: [],
      organization: { id: 'org-1', name: 'League', slug: 'league' },
      season: { id: 'season-1', name: 'Season', slug: 'season' },
    });

    const portal = await service.getLeaguePortal('league', 'season');

    expect(portal.schedule).toEqual([
      expect.objectContaining({ id: 'live-game', liveScoreIsUnofficial: true }),
    ]);
    expect(portal.results).toEqual([
      expect.objectContaining({ id: 'final-game', liveScoreIsUnofficial: false }),
    ]);
    expect(JSON.stringify(portal)).not.toMatch(
      /control_token|override_reason|audit_events|scorekeeper_member_id/,
    );
  });
});
