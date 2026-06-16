import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ROLES } from '../common/auth/roles';
import { OrganizationRolesGuard } from '../common/guards/organization-roles.guard';
import { OrganizationAuthorizationService } from './organization-authorization.service';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function createContext(
  overrides: {
    organizationId?: string;
    user?: typeof user;
  } = {},
): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        params: {
          organizationId: overrides.organizationId ?? 'org-1',
        },
        user: overrides.user ?? user,
      }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(requiredRoles: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as jest.Mocked<Reflector>;
  const authorizationService = {
    assertOrganizationAccess: jest.fn(),
  } as unknown as jest.Mocked<OrganizationAuthorizationService>;

  return {
    authorizationService,
    guard: new OrganizationRolesGuard(reflector, authorizationService),
    reflector,
  };
}

describe('OrganizationRolesGuard', () => {
  it('skips authorization when no org roles are required', async () => {
    const { authorizationService, guard } = createGuard(undefined);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(
      authorizationService.assertOrganizationAccess,
    ).not.toHaveBeenCalled();
  });

  it('authorizes authenticated users with the required org role', async () => {
    const { authorizationService, guard } = createGuard([AUTH_ROLES.ADMIN]);

    authorizationService.assertOrganizationAccess.mockResolvedValue({
      organization_id: 'org-1',
      role: AUTH_ROLES.ADMIN,
      status: 'active',
      user_id: user.id,
    });

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(authorizationService.assertOrganizationAccess).toHaveBeenCalledWith(
      user.id,
      'org-1',
      [AUTH_ROLES.ADMIN],
    );
  });
});
