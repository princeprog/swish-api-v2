import { PublicService } from './public.service';

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
});
