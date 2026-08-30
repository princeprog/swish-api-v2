import { ConflictException } from '@nestjs/common';
import { ScheduleService } from './schedule.service';

const validMatchup = {
  away_team_id: 'team-away',
  division_format_id: 'format-1',
  matchup_format_revision: 3,
  home_team_id: 'team-home',
  id: 'matchup-1',
  stage: 'qualifier',
  matchup_status: 'ready',
  division_id: 'division-1',
  format_revision: 3,
  format_status: 'locked',
  league_season_id: 'season-1',
  organization_id: 'org-1',
};

function query(result: unknown) {
  return {
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    innerJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

function createService(matchup: Record<string, unknown> | undefined) {
  const matchupQuery = query(matchup);
  const existingGameQuery = query(undefined);
  const db = {
    selectFrom: jest
      .fn()
      .mockReturnValueOnce(matchupQuery)
      .mockReturnValueOnce(existingGameQuery),
    transaction: jest.fn(),
  };
  return {
    db,
    service: new ScheduleService(db as never),
  };
}

const input = {
  awayTeamId: 'team-away',
  competitionKind: 'stage' as const,
  divisionId: 'division-1',
  homeTeamId: 'team-home',
  leagueSeasonId: 'season-1',
  matchupId: 'matchup-1',
  startsAt: '2026-09-01T10:00:00.000Z',
  status: 'scheduled' as const,
  venueId: 'venue-1',
};

describe('ScheduleService generated fixture identity', () => {
  it('accepts the exact current generated matchup identity', async () => {
    const { service } = createService(validMatchup);

    await expect(
      (service as any).assertCompetitionGameIdentity('org-1', input),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['organization', { organization_id: 'other-org' }],
    ['season', { league_season_id: 'other-season' }],
    ['division', { division_id: 'other-division' }],
    ['home team', { home_team_id: 'other-home' }],
    ['away team', { away_team_id: 'other-away' }],
    ['format revision', { matchup_format_revision: 2 }],
    ['format status', { format_status: 'draft' }],
    ['competition stage', { stage: 'playoff' }],
    ['matchup status', { matchup_status: 'scheduled' }],
  ])('rejects a mismatched %s before inserting a game', async (_, mismatch) => {
    const { db, service } = createService({ ...validMatchup, ...mismatch });

    await expect(
      (service as any).assertCompetitionGameIdentity('org-1', input),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a matchup that already has a generated game', async () => {
    const matchupQuery = query(validMatchup);
    const existingGameQuery = query({ id: 'game-1' });
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(matchupQuery)
        .mockReturnValueOnce(existingGameQuery),
      transaction: jest.fn(),
    };
    const service = new ScheduleService(db as never);

    await expect(
      (service as any).assertCompetitionGameIdentity('org-1', input),
    ).rejects.toThrow('already has a scheduled game');
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects forged competition creation before any insert or assignment', async () => {
    const { db, service } = createService({
      ...validMatchup,
      home_team_id: 'forged-home',
    });

    await expect(
      service.createCompetitionGame('org-1', {
        membershipId: 'member-1',
        organizationId: 'org-1',
        permissions: [],
        role: 'admin',
        userId: 'user-1',
      }, input),
    ).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a competition kind that does not match the matchup stage', async () => {
    const { db, service } = createService(validMatchup);

    await expect(
      (service as any).assertCompetitionGameIdentity('org-1', {
        ...input,
        competitionKind: 'playoff',
      }),
    ).rejects.toThrow(ConflictException);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['home', { home_team_id: null }],
    ['away', { away_team_id: null }],
  ])(
    'rejects an authoritative matchup with no %s team before insert or assignment',
    async (_, missingTeam) => {
      const { db, service } = createService({ ...validMatchup, ...missingTeam });

      await expect(
        service.createCompetitionGame(
          'org-1',
          {
            membershipId: 'member-1',
            organizationId: 'org-1',
            permissions: [],
            role: 'admin',
            userId: 'user-1',
          },
          input,
        ),
      ).rejects.toThrow(ConflictException);
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
});
