import { PublicController } from './public.controller';
import type { PublicService } from './public.service';

const publicLeagueShell = {
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
};

const publicOrganization = {
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
};

function createController() {
  const publicService = {
    getOrganization: jest.fn(),
    getLeagueShell: jest.fn(),
    getLeaguePortal: jest.fn(),
  } as unknown as jest.Mocked<PublicService>;

  return {
    controller: new PublicController(publicService),
    publicService,
  };
}

describe('PublicController', () => {
  it('returns a public organization lookup by slug', async () => {
    const { controller, publicService } = createController();

    publicService.getOrganization.mockResolvedValue(publicOrganization);

    await expect(controller.getOrganization('swish-league')).resolves.toEqual(
      publicOrganization,
    );
    await expect(
      controller.getOrganization('swish-league'),
    ).resolves.not.toHaveProperty('user_id');
    expect(publicService.getOrganization).toHaveBeenCalledWith('swish-league');
  });

  it('returns a public-safe league shell by organization and season slug', async () => {
    const { controller, publicService } = createController();

    publicService.getLeagueShell.mockResolvedValue(publicLeagueShell);

    await expect(
      controller.getLeagueShell('swish-league', 'season-1'),
    ).resolves.toEqual(publicLeagueShell);
    await expect(
      controller.getLeagueShell('swish-league', 'season-1'),
    ).resolves.not.toHaveProperty('organization_members');
    expect(publicService.getLeagueShell).toHaveBeenCalledWith(
      'swish-league',
      'season-1',
    );
  });

  it('returns the complete public league portal without private operations data', async () => {
    const { controller, publicService } = createController();
    const portal = {
      ...publicLeagueShell,
      awards: [],
      bracket: [],
      leaders: [],
      results: [],
      schedule: [],
      standings: [],
    };
    publicService.getLeaguePortal.mockResolvedValue(portal as never);

    await expect(
      controller.getLeaguePortal('swish-league', 'season-1'),
    ).resolves.toEqual(portal);
    expect(JSON.stringify(portal)).not.toMatch(
      /control_token|audit_events|override_reason|statistician_member_id/,
    );
  });
});
