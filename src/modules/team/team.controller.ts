import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamListQueryDto } from './dto/team-list-query.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamService } from './team.service';

@Controller('organizations/:organizationId/teams')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.TEAMS_CREATE)
  create(
    @Param('organizationId') organizationId: string,
    @Body() createTeamDto: CreateTeamDto,
  ) {
    return this.teamService.create(organizationId, createTeamDto);
  }

  @Get()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findAll(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: TeamListQueryDto,
  ) {
    return this.teamService.findAll(organizationId, access, query);
  }

  @Get(':teamId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.teamService.findOne(organizationId, teamId, access);
  }

  @Patch(':teamId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  update(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updateTeamDto: UpdateTeamDto,
  ) {
    return this.teamService.update(
      organizationId,
      teamId,
      access,
      updateTeamDto,
    );
  }

  @Delete(':teamId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.TEAMS_DELETE)
  remove(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.teamService.remove(organizationId, teamId, access);
  }

  @Post(':teamId/archive')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.TEAMS_DELETE)
  archive(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.teamService.archive(organizationId, teamId, access);
  }

  @Post(':teamId/restore')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.TEAMS_DELETE)
  restore(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.teamService.restore(organizationId, teamId, access);
  }
}
