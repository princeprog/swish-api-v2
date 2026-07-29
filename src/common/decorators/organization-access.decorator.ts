import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { OrganizationAccessContext } from '../auth/roles';
import type { AuthenticatedRequest } from '../../modules/auth/auth.request';

export const OrganizationAccess = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrganizationAccessContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return request.organizationAccess as OrganizationAccessContext;
  },
);
