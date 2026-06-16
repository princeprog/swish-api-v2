export const AUTH_ROLES = {
  ADMIN: 'admin',
  COACH: 'coach',
  OWNER: 'owner',
  PLAYER: 'player',
  SCORER: 'scorer',
} as const;

export type AuthRole = (typeof AUTH_ROLES)[keyof typeof AUTH_ROLES];

export const ORGANIZATION_ROLE_METADATA_KEY = 'organization_roles';

export type OrganizationMembership = {
  organization_id: string;
  role: AuthRole;
  status: string;
  user_id: string;
};
