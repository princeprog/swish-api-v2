import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReturnRosterDto } from './dto/return-roster.dto';
import { StartAmendmentDto } from './dto/start-amendment.dto';
import { UpdateRosterSettingsDto } from './dto/update-roster-settings.dto';
import { RosterService } from './roster.service';

@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class RosterController {
  constructor(private readonly rosterService: RosterService) {}

  @Get('divisions/:divisionId/rosters')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findDivisionRosters(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.findDivisionRosters(
      organizationId,
      divisionId,
      access,
    );
  }

  @Patch('divisions/:divisionId/roster-settings')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ROSTER_SETTINGS_MANAGE)
  updateSettings(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: UpdateRosterSettingsDto,
  ) {
    return this.rosterService.updateSettings(
      organizationId,
      divisionId,
      access,
      dto,
    );
  }

  @Post('divisions/:divisionId/rosters/publish')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ROSTERS_PUBLISH)
  publishDivisionRosters(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.publishDivisionRosters(
      organizationId,
      divisionId,
      access,
    );
  }

  @Get('teams/:teamId/roster')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findTeamRoster(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.findTeamRoster(organizationId, teamId, access);
  }

  @Get('teams/:teamId/roster/history')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findHistory(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.findHistory(organizationId, teamId, access);
  }

  @Post('teams/:teamId/roster/submit')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  submitTeamRoster(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.submitTeamRoster(organizationId, teamId, access);
  }

  @Post('teams/:teamId/roster/start-amendment')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  startAmendment(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: StartAmendmentDto,
  ) {
    return this.rosterService.startAmendment(
      organizationId,
      teamId,
      access,
      dto,
    );
  }

  @Post('teams/:teamId/roster/approve')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ROSTERS_REVIEW)
  approveTeamRoster(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.rosterService.approveTeamRoster(organizationId, teamId, access);
  }

  @Post('teams/:teamId/roster/return')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ROSTERS_REVIEW)
  returnTeamRoster(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: ReturnRosterDto,
  ) {
    return this.rosterService.returnTeamRoster(
      organizationId,
      teamId,
      access,
      dto,
    );
  }
}
