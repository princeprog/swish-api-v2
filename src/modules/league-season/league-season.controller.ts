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
import { ORGANIZATION_PERMISSIONS } from '../../common/auth/roles';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';
import { LeagueSeasonService } from './league-season.service';

@Controller('organizations/:organizationId/league-seasons')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
export class LeagueSeasonController {
  constructor(private readonly leagueSeasonService: LeagueSeasonService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createLeagueSeasonDto: CreateLeagueSeasonDto,
  ) {
    return this.leagueSeasonService.create(
      organizationId,
      createLeagueSeasonDto,
    );
  }

  @Get()
  findAll(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.leagueSeasonService.findAll(organizationId, query);
  }

  @Get(':leagueSeasonId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('leagueSeasonId') leagueSeasonId: string,
  ) {
    return this.leagueSeasonService.findOne(organizationId, leagueSeasonId);
  }

  @Patch(':leagueSeasonId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('leagueSeasonId') leagueSeasonId: string,
    @Body() updateLeagueSeasonDto: UpdateLeagueSeasonDto,
  ) {
    return this.leagueSeasonService.update(
      organizationId,
      leagueSeasonId,
      updateLeagueSeasonDto,
    );
  }

  @Delete(':leagueSeasonId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('leagueSeasonId') leagueSeasonId: string,
  ) {
    return this.leagueSeasonService.remove(organizationId, leagueSeasonId);
  }
}
