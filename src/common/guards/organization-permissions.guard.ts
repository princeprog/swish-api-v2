import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ORGANIZATION_ANY_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSION_METADATA_KEY,
  type OrganizationPermission,
} from '../auth/roles';
import type { AuthenticatedRequest } from '../../modules/auth/auth.request';
import { OrganizationAuthorizationService } from '../../modules/auth/organization-authorization.service';

@Injectable()
export class OrganizationPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: OrganizationAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      OrganizationPermission[]
    >(ORGANIZATION_PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const alternativePermissions = this.reflector.getAllAndOverride<
      OrganizationPermission[]
    >(ORGANIZATION_ANY_PERMISSION_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions?.length && !alternativePermissions?.length) {
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

    request.organizationAccess = alternativePermissions?.length
      ? await this.authorizationService.assertAnyOrganizationPermission(
          request.user.id,
          organizationId,
          alternativePermissions,
        )
      : await this.authorizationService.assertOrganizationPermissions(
          request.user.id,
          organizationId,
          requiredPermissions ?? [],
        );

    return true;
  }
}
