import { AUTH_ROLES, type OrganizationAccessContext } from '../../common/auth/roles';
import { TeamManagerWorkspaceService } from './team-manager-workspace.service';

const managerAccess: OrganizationAccessContext = {
  membershipId: 'manager-member-1',
  organizationId: 'org-1',
  permissions: ['teams.read.assigned'],
  role: AUTH_ROLES.TEAM_MANAGER,
  userId: 'user-manager-1',
};

function createService(rows: unknown[]) {
  const execute = jest.fn().mockResolvedValue(rows);
  const query = {
    execute,
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
  const db = {
    selectFrom: jest.fn().mockReturnValue(query),
  };

  return {
    db,
    query,
    service: new TeamManagerWorkspaceService(db as never),
  };
}

describe('TeamManagerWorkspaceService', () => {
  it('queries only the signed-in manager assignments in the organization', async () => {
    const { db, query, service } = createService([]);

    await service.getWorkspace('org-1', managerAccess);

    expect(db.selectFrom).toHaveBeenCalledWith(
      'access.team_manager_assignments as assignments',
    );
    expect(query.where).toHaveBeenCalledWith(
      'assignments.organization_member_id',
      '=',
      'manager-member-1',
    );
    expect(query.where).toHaveBeenCalledWith(
      'league_seasons.organization_id',
      '=',
      'org-1',
    );
  });

  it('uses the newest active assigned season as the default season', async () => {
    const { service } = createService([
      {
        assignment_id: 'assignment-old',
        division_id: 'division-old',
        division_name: '18 under',
        division_slug: '18-under',
        league_season_id: 'season-old',
        league_season_name: 'Past season',
        league_season_slug: 'past-season',
        league_season_status: 'inactive',
        roster_amendment_reason: null,
        roster_published_version_id: null,
        roster_return_reason: null,
        roster_status: 'draft',
        roster_submission_deadline_at: null,
        team_color: null,
        team_id: 'team-old',
        team_name: 'Past Team',
        team_slug: 'past-team',
        team_status: 'active',
      },
      {
        assignment_id: 'assignment-active',
        division_id: 'division-active',
        division_name: 'Senior Open',
        division_slug: 'senior-open',
        league_season_id: 'season-active',
        league_season_name: 'Current season',
        league_season_slug: 'current-season',
        league_season_status: 'active',
        roster_amendment_reason: null,
        roster_published_version_id: 'version-1',
        roster_return_reason: null,
        roster_status: 'approved',
        roster_submission_deadline_at: new Date('2026-08-20T15:59:00.000Z'),
        team_color: '#16a34a',
        team_id: 'team-active',
        team_name: 'Current Team',
        team_slug: 'current-team',
        team_status: 'active',
      },
    ]);

    await expect(service.getWorkspace('org-1', managerAccess)).resolves.toEqual({
      assignments: [
        expect.objectContaining({
          season: expect.objectContaining({ id: 'season-old' }),
          team: expect.objectContaining({ id: 'team-old' }),
        }),
        expect.objectContaining({
          roster: expect.objectContaining({
            publishedVersionId: 'version-1',
            status: 'approved',
          }),
          season: expect.objectContaining({ id: 'season-active' }),
          team: expect.objectContaining({ id: 'team-active' }),
        }),
      ],
      defaultSeasonId: 'season-active',
    });
  });
});
