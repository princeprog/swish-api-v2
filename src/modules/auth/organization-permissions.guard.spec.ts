import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AUTH_ROLES,
  ORGANIZATION_ANY_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { RequireAnyOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
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
      getAllAndOverride: jest.fn((key: string) =>
        key === ORGANIZATION_PERMISSION_METADATA_KEY
          ? [ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE]
          : undefined,
      ),
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

  it('accepts any one of the alternative permissions for scoring endpoints', async () => {
    class TestController {
      @RequireAnyOrganizationPermissions(
        ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
        ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
      )
      score() {
        return undefined;
      }
    }

    const handler = TestController.prototype.score;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === ORGANIZATION_ANY_PERMISSION_METADATA_KEY
          ? [
              ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
              ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
            ]
          : undefined,
      ),
    } as unknown as jest.Mocked<Reflector>;
    const authorizationService = {
      assertAnyOrganizationPermission: jest.fn().mockResolvedValue({
        membershipId: 'member-1',
        organizationId: 'org-1',
        permissions: [ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED],
        role: AUTH_ROLES.SCOREKEEPER,
        userId: user.id,
      }),
    } as unknown as jest.Mocked<OrganizationAuthorizationService>;
    const context = {
      ...createContext(),
      getHandler: () => handler,
    } as unknown as ExecutionContext;
    const request = context.switchToHttp().getRequest();
    const guard = new OrganizationPermissionsGuard(
      reflector,
      authorizationService,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(
      authorizationService.assertAnyOrganizationPermission,
    ).toHaveBeenCalledWith(user.id, 'org-1', [
      ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
      ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
    ]);
    expect(request.organizationAccess).toEqual(
      expect.objectContaining({
        role: AUTH_ROLES.SCOREKEEPER,
      }),
    );
  });
});
