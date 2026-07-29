import {
  AUTH_ROLES,
  ORGANIZATION_PERMISSIONS,
  getPermissionsForOrganizationRole,
} from './roles';

describe('organization role permissions', () => {
  it('maps owner to access management and operational permissions', () => {
    expect(getPermissionsForOrganizationRole(AUTH_ROLES.OWNER)).toEqual(
      expect.arrayContaining([
        ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE,
        ORGANIZATION_PERMISSIONS.ORGANIZATION_MANAGE,
        ORGANIZATION_PERMISSIONS.TEAMS_CREATE,
        ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
      ]),
    );
  });

  it('maps admin to league operations but not access management', () => {
    const permissions = getPermissionsForOrganizationRole(AUTH_ROLES.ADMIN);

    expect(permissions).toEqual(
      expect.arrayContaining([
        ORGANIZATION_PERMISSIONS.TEAMS_CREATE,
        ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
      ]),
    );
    expect(permissions).not.toContain(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE);
    expect(permissions).not.toContain(
      ORGANIZATION_PERMISSIONS.ORGANIZATION_TRANSFER,
    );
  });

  it('maps team manager to assigned team and roster permissions only', () => {
    const permissions = getPermissionsForOrganizationRole(
      AUTH_ROLES.TEAM_MANAGER,
    );

    expect(permissions).toEqual(
      expect.arrayContaining([
        ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED,
        ORGANIZATION_PERMISSIONS.TEAMS_UPDATE_ASSIGNED,
        ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE_ASSIGNED_TEAM,
      ]),
    );
    expect(permissions).not.toContain(ORGANIZATION_PERMISSIONS.TEAMS_CREATE);
  });

  it('maps scorekeeper to assigned game scoring contract only', () => {
    const permissions = getPermissionsForOrganizationRole(
      AUTH_ROLES.SCOREKEEPER,
    );

    expect(permissions).toEqual([
      ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED,
      ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
    ]);
  });
});
