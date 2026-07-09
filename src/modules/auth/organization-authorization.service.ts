import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthRole, OrganizationMembership } from '../../common/auth/roles';
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

  hasRequiredRole(role: AuthRole, requiredRoles: AuthRole[]): boolean {
    return requiredRoles.includes(role);
  }
}
