import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUTH_ROLES, ORGANIZATION_PERMISSIONS } from '../../common/auth/roles';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import type { OrganizationAuthorizationService } from './organization-authorization.service';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function createContext(): ExecutionContext {
  const request = {
    params: { organizationId: 'org-1' },
    user,
  };

  return {
    getClass: jest.fn(),
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('OrganizationPermissionsGuard', () => {
  it('attaches organization access context when permissions pass', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue([ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE]),
    } as unknown as jest.Mocked<Reflector>;
    const authorizationService = {
      assertOrganizationPermissions: jest.fn().mockResolvedValue({
        membershipId: 'member-1',
        organizationId: 'org-1',
        permissions: [ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE],
        role: AUTH_ROLES.OWNER,
        userId: user.id,
      }),
    } as unknown as jest.Mocked<OrganizationAuthorizationService>;
    const context = createContext();
    const request = context.switchToHttp().getRequest();
    const guard = new OrganizationPermissionsGuard(
      reflector,
      authorizationService,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.organizationAccess).toEqual(
      expect.objectContaining({
        membershipId: 'member-1',
        role: AUTH_ROLES.OWNER,
      }),
    );
  });
});
