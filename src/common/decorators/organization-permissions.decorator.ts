import { SetMetadata } from '@nestjs/common';
import {
  ORGANIZATION_ANY_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSION_METADATA_KEY,
  type OrganizationPermission,
} from '../auth/roles';

export function RequireOrganizationPermissions(
  ...permissions: OrganizationPermission[]
) {
  return SetMetadata(ORGANIZATION_PERMISSION_METADATA_KEY, permissions);
}

export function RequireAnyOrganizationPermissions(
  ...permissions: OrganizationPermission[]
) {
  return SetMetadata(ORGANIZATION_ANY_PERMISSION_METADATA_KEY, permissions);
}
