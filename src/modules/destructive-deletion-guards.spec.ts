import { ConflictException } from '@nestjs/common';
import { DivisionService } from './division/division.service';
import { LeagueSeasonService } from './league-season/league-season.service';
import { OrganizationService } from './organization/organization.service';
import { PlayerService } from './player/player.service';
import { ScheduleService } from './schedule/schedule.service';
import { TeamService } from './team/team.service';
import { VenueService } from './venue/venue.service';

describe('destructive league deletion guards', () => {
  const cases = [
    ['organization', (db: any) => new OrganizationService(db), (service: any) => service.remove('org-1', { organizationId: 'org-1', membershipId: 'member-1' })],
    ['league season', (db: any) => new LeagueSeasonService(db), (service: any) => service.remove('org-1', 'season-1')],
    ['division', (db: any) => new DivisionService(db), (service: any) => service.remove('org-1', 'division-1')],
    ['team', (db: any) => new TeamService(db), (service: any) => service.remove('org-1', 'team-1')],
    ['player', (db: any) => new PlayerService(db, {} as never), (service: any) => service.remove('org-1', 'player-1', { organizationId: 'org-1', membershipId: 'member-1' })],
    ['venue', (db: any) => new VenueService(db), (service: any) => service.remove('org-1', 'venue-1')],
    ['game', (db: any) => new ScheduleService(db), (service: any) => service.remove('org-1', 'game-1')],
  ] as const;

  it.each(cases)('%s removal is blocked before any database mutation', async (_name, createService, remove) => {
    const db = {
      deleteFrom: jest.fn(),
      selectFrom: jest.fn(),
      updateTable: jest.fn(),
      insertInto: jest.fn(),
    };

    await expect(remove(createService(db))).rejects.toThrow(
      new ConflictException(
        'This record cannot be deleted. Archive support is being prepared so league history remains available.',
      ),
    );

    expect(db.deleteFrom).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
  });
});
