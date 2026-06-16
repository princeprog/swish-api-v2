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

    leagueSeasonService.create.mockResolvedValue({ id: 'league-1' });
    divisionService.create.mockResolvedValue({ id: 'division-1' });
    teamService.create.mockResolvedValue({ id: 'team-1' });
    playerService.create.mockResolvedValue({ id: 'player-1' });
    venueService.create.mockResolvedValue({ id: 'venue-1' });

    await expect(
      leagueSeasonController.create('org-1', {
        name: 'Season 1',
        organizationId: 'org-1',
        slug: 'season-1',
      }),
    ).resolves.toEqual({ id: 'league-1' });

    await expect(
      divisionController.create('org-1', {
        leagueSeasonId: 'league-1',
        name: 'Seniors',
        slug: 'seniors',
      }),
    ).resolves.toEqual({ id: 'division-1' });

    await expect(
      teamController.create('org-1', {
        divisionId: 'division-1',
        name: 'Falcons',
        slug: 'falcons',
      }),
    ).resolves.toEqual({ id: 'team-1' });

    await expect(
      playerController.create('org-1', {
        jerseyNumber: '23',
        name: 'Jordan Cruz',
        teamId: 'team-1',
      }),
    ).resolves.toEqual({ id: 'player-1' });

    await expect(
      venueController.create('org-1', {
        leagueSeasonId: 'league-1',
        name: 'Main Court',
        slug: 'main-court',
      }),
    ).resolves.toEqual({ id: 'venue-1' });
  });
});
