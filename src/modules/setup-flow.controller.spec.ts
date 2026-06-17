import { DivisionController } from './division/division.controller';
import { LeagueSeasonController } from './league-season/league-season.controller';
import { PlayerController } from './player/player.controller';
import { TeamController } from './team/team.controller';
import { VenueController } from './venue/venue.controller';
import type { DivisionService } from './division/division.service';
import type { LeagueSeasonService } from './league-season/league-season.service';
import type { PlayerService } from './player/player.service';
import type { TeamService } from './team/team.service';
import type { VenueService } from './venue/venue.service';

function createMocks() {
  const leagueSeasonService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<LeagueSeasonService>;
  const divisionService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<DivisionService>;
  const teamService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<TeamService>;
  const playerService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<PlayerService>;
  const venueService = {
    create: jest.fn(),
  } as unknown as jest.Mocked<VenueService>;

  return {
    divisionController: new DivisionController(divisionService),
    divisionService,
    leagueSeasonController: new LeagueSeasonController(leagueSeasonService),
    leagueSeasonService,
    playerController: new PlayerController(playerService),
    playerService,
    teamController: new TeamController(teamService),
    teamService,
    venueController: new VenueController(venueService),
    venueService,
  };
}

describe('Admin setup flow controllers', () => {
  it('supports a happy-path setup flow across league resources', async () => {
    const {
      divisionController,
      divisionService,
      leagueSeasonController,
      leagueSeasonService,
      playerController,
      playerService,
      teamController,
      teamService,
      venueController,
      venueService,
    } = createMocks();

    leagueSeasonService.create.mockResolvedValue({
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      id: 'league-1',
      name: 'Season 1',
      organization_id: 'org-1',
      public_enabled: false,
      slug: 'season-1',
      status: 'draft',
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    });
    divisionService.create.mockResolvedValue({
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      id: 'division-1',
      league_season_id: 'league-1',
      name: 'Seniors',
      slug: 'seniors',
      status: 'active',
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    });
    teamService.create.mockResolvedValue({
      color: null,
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      division_id: 'division-1',
      id: 'team-1',
      name: 'Falcons',
      slug: 'falcons',
      status: 'active',
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    });
    playerService.create.mockResolvedValue({
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      id: 'player-1',
      jersey_number: '23',
      name: 'Jordan Cruz',
      status: 'active',
      team_id: 'team-1',
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    });
    venueService.create.mockResolvedValue({
      created_at: new Date('2026-06-17T00:00:00.000Z'),
      id: 'venue-1',
      league_season_id: 'league-1',
      name: 'Main Court',
      slug: 'main-court',
      status: 'active',
      updated_at: new Date('2026-06-17T00:00:00.000Z'),
    });

    await expect(
      leagueSeasonController.create('org-1', {
        name: 'Season 1',
        organizationId: 'org-1',
        slug: 'season-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'league-1',
      }),
    );

    await expect(
      divisionController.create('org-1', {
        leagueSeasonId: 'league-1',
        name: 'Seniors',
        slug: 'seniors',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'division-1',
      }),
    );

    await expect(
      teamController.create('org-1', {
        divisionId: 'division-1',
        name: 'Falcons',
        slug: 'falcons',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'team-1',
      }),
    );

    await expect(
      playerController.create('org-1', {
        jerseyNumber: '23',
        name: 'Jordan Cruz',
        teamId: 'team-1',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'player-1',
      }),
    );

    await expect(
      venueController.create('org-1', {
        leagueSeasonId: 'league-1',
        name: 'Main Court',
        slug: 'main-court',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'venue-1',
      }),
    );
  });
});
