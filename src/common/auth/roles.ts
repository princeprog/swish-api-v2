export const AUTH_ROLES = {
  ADMIN: 'admin',
  OWNER: 'owner',
  SCOREKEEPER: 'scorekeeper',
  TEAM_MANAGER: 'team_manager',
} as const;

export type AuthRole = (typeof AUTH_ROLES)[keyof typeof AUTH_ROLES];

export const ORGANIZATION_ROLE_METADATA_KEY = 'organization_roles';
export const ORGANIZATION_PERMISSION_METADATA_KEY = 'organization_permissions';
export const ORGANIZATION_ANY_PERMISSION_METADATA_KEY =
  'organization_any_permissions';

export const ORGANIZATION_PERMISSIONS = {
  DIVISIONS_MANAGE: 'divisions.manage',
  GAME_SCORE_ASSIGNED: 'game.score.assigned',
  GAME_SCORE_OVERRIDE: 'game.score.override',
  GAMES_READ_ASSIGNED: 'games.read.assigned',
  MEMBERS_MANAGE: 'members.manage',
  ORGANIZATION_MANAGE: 'organization.manage',
  ORGANIZATION_READ: 'organization.read',
  ORGANIZATION_TRANSFER: 'organization.transfer',
  PLAYERS_MANAGE: 'players.manage',
  PLAYERS_MANAGE_ASSIGNED_TEAM: 'players.manage.assigned_team',
  PLAYERS_READ_ASSIGNED_TEAM: 'players.read.assigned_team',
  ROSTER_SETTINGS_MANAGE: 'roster_settings.manage',
  ROSTERS_PUBLISH: 'rosters.publish',
  ROSTERS_READ_ASSIGNED_DIVISION: 'rosters.read.assigned_division',
  ROSTERS_REVIEW: 'rosters.review',
  ROSTERS_SUBMIT_ASSIGNED_TEAM: 'rosters.submit.assigned_team',
  SCHEDULE_MANAGE: 'schedule.manage',
  STANDINGS_READ: 'standings.read',
  STANDINGS_READ_ASSIGNED_DIVISION: 'standings.read.assigned_division',
  TEAMS_CREATE: 'teams.create',
  TEAMS_DELETE: 'teams.delete',
  TEAMS_READ: 'teams.read',
  TEAMS_READ_ASSIGNED: 'teams.read.assigned',
  TEAMS_UPDATE: 'teams.update',
  TEAMS_UPDATE_ASSIGNED: 'teams.update.assigned',
  VENUES_MANAGE: 'venues.manage',
} as const;

export type OrganizationPermission =
  (typeof ORGANIZATION_PERMISSIONS)[keyof typeof ORGANIZATION_PERMISSIONS];

const OWNER_PERMISSIONS = Object.values(ORGANIZATION_PERMISSIONS);

const ADMIN_PERMISSIONS: OrganizationPermission[] = [
  ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
  ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE,
  ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED,
  ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE,
  ORGANIZATION_PERMISSIONS.ROSTER_SETTINGS_MANAGE,
  ORGANIZATION_PERMISSIONS.ROSTERS_PUBLISH,
  ORGANIZATION_PERMISSIONS.ROSTERS_READ_ASSIGNED_DIVISION,
  ORGANIZATION_PERMISSIONS.ROSTERS_REVIEW,
  ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
  ORGANIZATION_PERMISSIONS.STANDINGS_READ,
  ORGANIZATION_PERMISSIONS.STANDINGS_READ_ASSIGNED_DIVISION,
  ORGANIZATION_PERMISSIONS.TEAMS_CREATE,
  ORGANIZATION_PERMISSIONS.TEAMS_DELETE,
  ORGANIZATION_PERMISSIONS.TEAMS_READ,
  ORGANIZATION_PERMISSIONS.TEAMS_UPDATE,
  ORGANIZATION_PERMISSIONS.VENUES_MANAGE,
  ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
];

const TEAM_MANAGER_PERMISSIONS: OrganizationPermission[] = [
  ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
  ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED,
  ORGANIZATION_PERMISSIONS.TEAMS_UPDATE_ASSIGNED,
  ORGANIZATION_PERMISSIONS.PLAYERS_READ_ASSIGNED_TEAM,
  ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE_ASSIGNED_TEAM,
  ORGANIZATION_PERMISSIONS.ROSTERS_READ_ASSIGNED_DIVISION,
  ORGANIZATION_PERMISSIONS.ROSTERS_SUBMIT_ASSIGNED_TEAM,
  ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED,
  ORGANIZATION_PERMISSIONS.STANDINGS_READ_ASSIGNED_DIVISION,
];

const SCOREKEEPER_PERMISSIONS: OrganizationPermission[] = [
  ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED,
  ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
];

export const ORGANIZATION_ROLE_PERMISSIONS: Record<
  AuthRole,
  OrganizationPermission[]
> = {
  [AUTH_ROLES.ADMIN]: ADMIN_PERMISSIONS,
  [AUTH_ROLES.OWNER]: OWNER_PERMISSIONS,
  [AUTH_ROLES.SCOREKEEPER]: SCOREKEEPER_PERMISSIONS,
  [AUTH_ROLES.TEAM_MANAGER]: TEAM_MANAGER_PERMISSIONS,
};

export type OrganizationAccessContext = {
  membershipId: string;
  organizationId: string;
  permissions: OrganizationPermission[];
  role: AuthRole;
  userId: string;
};

export type OrganizationMembership = {
  id: string;
  organization_id: string;
  role: AuthRole;
  status: string;
  user_id: string;
};

export function getPermissionsForOrganizationRole(
  role: AuthRole,
): OrganizationPermission[] {
  return ORGANIZATION_ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasOrganizationPermission(
  role: AuthRole,
  permission: OrganizationPermission,
): boolean {
  return getPermissionsForOrganizationRole(role).includes(permission);
}
