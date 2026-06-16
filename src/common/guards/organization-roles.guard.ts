import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../../modules/auth/auth.request';
import { OrganizationAuthorizationService } from '../../modules/auth/organization-authorization.service';
import { ORGANIZATION_ROLE_METADATA_KEY, type AuthRole } from '../auth/roles';

@Injectable()
export class OrganizationRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: OrganizationAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(
      ORGANIZATION_ROLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationIdParam = request.params?.organizationId;
    const organizationId =
      typeof organizationIdParam === 'string' ? organizationIdParam : undefined;

    if (!request.user) {
      throw new UnauthorizedException('Missing authenticated user');
    }

    if (!organizationId) {
      throw new UnauthorizedException('Missing organization scope');
    }

    await this.authorizationService.assertOrganizationAccess(
      request.user.id,
      organizationId,
      requiredRoles,
    );

    return true;
  }
}
