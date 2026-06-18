import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AUTH_ROLES } from '../../common/auth/roles';
import { OrganizationRoles } from '../../common/decorators/organization-roles.decorator';
import { OrganizationRolesGuard } from '../../common/guards/organization-roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { ScheduleService } from './schedule.service';

@Controller('organizations/:organizationId/games')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createScheduleDto: CreateScheduleDto,
  ) {
    return this.scheduleService.create(organizationId, createScheduleDto);
  }

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.scheduleService.findAll(organizationId);
  }

  @Get(':gameId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
  ) {
    return this.scheduleService.findOne(organizationId, gameId);
  }

  @Patch(':gameId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @Body() updateScheduleDto: UpdateScheduleDto,
  ) {
    return this.scheduleService.update(organizationId, gameId, updateScheduleDto);
  }

  @Delete(':gameId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
  ) {
    return this.scheduleService.remove(organizationId, gameId);
  }
}
