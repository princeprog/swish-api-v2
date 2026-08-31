import { ForbiddenException } from '@nestjs/common';
import {
  AUTH_ROLES,
  type AuthRole,
  type OrganizationMembership,
} from '../../common/auth/roles';
import { OrganizationAuthorizationService } from './organization-authorization.service';
import type { AuthRepository } from './auth.repository';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function membership(role: AuthRole): OrganizationMembership {
  return {
    id: 'member-1',
    organization_id: 'org-1',
    role,
    status: 'active',
    user_id: user.id,
  };
}

function createService() {
  const authRepository = {
    findActiveOrganizationMembership: jest.fn(),
  } as unknown as jest.Mocked<AuthRepository>;

  return {
    authRepository,
    service: new OrganizationAuthorizationService(authRepository),
  };
}

describe('OrganizationAuthorizationService', () => {
  it('allows owner/admin routes for active owner membership', async () => {
    const { authRepository, service } = createService();

    authRepository.findActiveOrganizationMembership.mockResolvedValue(
      membership(AUTH_ROLES.OWNER),
    );

    await expect(
      service.assertOrganizationAccess(user.id, 'org-1', [
        AUTH_ROLES.OWNER,
        AUTH_ROLES.ADMIN,
      ]),
    ).resolves.toEqual(
      expect.objectContaining({
        organization_id: 'org-1',
        role: AUTH_ROLES.OWNER,
      }),
    );
  });

  it('rejects organization access when membership is missing', async () => {
    const { authRepository, service } = createService();

    authRepository.findActiveOrganizationMembership.mockResolvedValue(
      undefined,
    );

    await expect(
      service.assertOrganizationAccess(user.id, 'org-1', [AUTH_ROLES.ADMIN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects organization access when role is not allowed', async () => {
    const { authRepository, service } = createService();

    authRepository.findActiveOrganizationMembership.mockResolvedValue(
      membership(AUTH_ROLES.SCOREKEEPER),
    );

    await expect(
      service.assertOrganizationAccess(user.id, 'org-1', [AUTH_ROLES.ADMIN]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports role helper coverage for MVP roles', () => {
    const { service } = createService();

    expect(service.hasRequiredRole(AUTH_ROLES.OWNER, [AUTH_ROLES.OWNER])).toBe(
      true,
    );
    expect(service.hasRequiredRole(AUTH_ROLES.ADMIN, [AUTH_ROLES.ADMIN])).toBe(
      true,
    );
    expect(
      service.hasRequiredRole(AUTH_ROLES.SCOREKEEPER, [AUTH_ROLES.SCOREKEEPER]),
    ).toBe(true);
    expect(
      service.hasRequiredRole(AUTH_ROLES.TEAM_MANAGER, [
        AUTH_ROLES.TEAM_MANAGER,
      ]),
    ).toBe(true);
    expect(
      service.hasRequiredRole(AUTH_ROLES.STATISTICIAN, [
        AUTH_ROLES.STATISTICIAN,
      ]),
    ).toBe(true);
    expect(
      service.hasRequiredRole(AUTH_ROLES.STATISTICIAN, [AUTH_ROLES.ADMIN]),
    ).toBe(false);
  });
});
