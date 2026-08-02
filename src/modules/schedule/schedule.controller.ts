import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { ScheduleListQueryDto } from './dto/schedule-list-query.dto';
import { UpdateScorekeeperAssignmentDto } from './dto/update-scorekeeper-assignment.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleService } from './schedule.service';

@Controller('organizations/:organizationId/games')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  create(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() createScheduleDto: CreateScheduleDto,
  ) {
    return this.scheduleService.create(organizationId, access, createScheduleDto);
  }

  @Get('scorekeepers')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  findEligibleScorekeepers(@Param('organizationId') organizationId: string) {
    return this.scheduleService.findEligibleScorekeepers(organizationId);
  }

  @Get()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED)
  findAll(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: ScheduleListQueryDto,
  ) {
    return this.scheduleService.findAll(organizationId, access, query);
  }

  @Get(':gameId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.GAMES_READ_ASSIGNED)
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.scheduleService.findOne(organizationId, gameId, access);
  }

  @Patch(':gameId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  update(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
  ) {
    return this.scheduleService.update(
      organizationId,
      gameId,
      updateScheduleDto,
    );
  }

  @Put(':gameId/scorekeeper')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  updateScorekeeperAssignment(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updateScorekeeperAssignmentDto: UpdateScorekeeperAssignmentDto,
  ) {
    return this.scheduleService.updateScorekeeperAssignment(
      organizationId,
      gameId,
      access,
      updateScorekeeperAssignmentDto,
    );
  }

  @Delete(':gameId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  remove(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
  ) {
    return this.scheduleService.remove(organizationId, gameId);
  }
}
