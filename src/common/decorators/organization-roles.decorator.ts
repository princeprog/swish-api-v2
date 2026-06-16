import { SetMetadata } from '@nestjs/common';
import { ORGANIZATION_ROLE_METADATA_KEY, type AuthRole } from '../auth/roles';

export function OrganizationRoles(...roles: AuthRole[]) {
  return SetMetadata(ORGANIZATION_ROLE_METADATA_KEY, roles);
}
