import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  getPermissionsForOrganizationRole,
  type AuthRole,
  type OrganizationAccessContext,
  type OrganizationMembership,
  type OrganizationPermission,
} from '../../common/auth/roles';
import { AuthRepository } from './auth.repository';

@Injectable()
export class OrganizationAuthorizationService {
  constructor(private readonly authRepository: AuthRepository) {}

  async assertOrganizationAccess(
    userId: string,
    organizationId: string,
    requiredRoles: AuthRole[],
  ): Promise<OrganizationMembership> {
    const membership =
      await this.authRepository.findActiveOrganizationMembership(
        userId,
        organizationId,
      );

    if (!membership || !this.hasRequiredRole(membership.role, requiredRoles)) {
      throw new ForbiddenException(
        'You do not have access to this organization resource',
      );
    }

    return membership;
  }

  async assertOrganizationPermissions(
    userId: string,
    organizationId: string,
    requiredPermissions: OrganizationPermission[],
  ): Promise<OrganizationAccessContext> {
    const membership =
      await this.authRepository.findActiveOrganizationMembership(
        userId,
        organizationId,
      );
    const permissions = membership
      ? getPermissionsForOrganizationRole(membership.role)
      : [];

    if (
      !membership ||
      requiredPermissions.some(
        (requiredPermission) => !permissions.includes(requiredPermission),
      )
    ) {
      throw new ForbiddenException(
        'You do not have access to this organization resource',
      );
    }

    return {
      membershipId: membership.id,
      organizationId: membership.organization_id,
      permissions,
      role: membership.role,
      userId: membership.user_id,
    };
  }

  async assertAnyOrganizationPermission(
    userId: string,
    organizationId: string,
    alternativePermissions: OrganizationPermission[],
  ): Promise<OrganizationAccessContext> {
    const membership =
      await this.authRepository.findActiveOrganizationMembership(
        userId,
        organizationId,
      );
    const permissions = membership
      ? getPermissionsForOrganizationRole(membership.role)
      : [];

    if (
      !membership ||
      !alternativePermissions.some((permission) =>
        permissions.includes(permission),
      )
    ) {
      throw new ForbiddenException(
        'You do not have access to this organization resource',
      );
    }

    return {
      membershipId: membership.id,
      organizationId: membership.organization_id,
      permissions,
      role: membership.role,
      userId: membership.user_id,
    };
  }

  hasRequiredRole(role: AuthRole, requiredRoles: AuthRole[]): boolean {
    return requiredRoles.includes(role);
  }
}
