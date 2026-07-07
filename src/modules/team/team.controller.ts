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
import { AUTH_ROLES } from '../../common/auth/roles';
import { OrganizationRoles } from '../../common/decorators/organization-roles.decorator';
import { OrganizationRolesGuard } from '../../common/guards/organization-roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateTeamDto } from './dto/create-team.dto';
import { TeamListQueryDto } from './dto/team-list-query.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { TeamService } from './team.service';

@Controller('organizations/:organizationId/teams')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createTeamDto: CreateTeamDto,
  ) {
    return this.teamService.create(organizationId, createTeamDto);
  }

  @Get()
  findAll(
    @Param('organizationId') organizationId: string,
    @Query() query: TeamListQueryDto,
  ) {
    return this.teamService.findAll(organizationId, query);
  }

  @Get(':teamId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.teamService.findOne(organizationId, teamId);
  }

  @Patch(':teamId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Body() updateTeamDto: UpdateTeamDto,
  ) {
    return this.teamService.update(organizationId, teamId, updateTeamDto);
  }

  @Delete(':teamId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.teamService.remove(organizationId, teamId);
  }
}
