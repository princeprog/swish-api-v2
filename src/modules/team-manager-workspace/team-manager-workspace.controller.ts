import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TeamManagerWorkspaceService } from './team-manager-workspace.service';

@Controller('organizations/:organizationId/team-manager-workspace')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED)
export class TeamManagerWorkspaceController {
  constructor(
    private readonly workspaceService: TeamManagerWorkspaceService,
  ) {}

  @Get()
  getWorkspace(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.workspaceService.getWorkspace(organizationId, access);
  }
}
