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
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';
import { LeagueSeasonService } from './league-season.service';

@Controller('organizations/:organizationId/league-seasons')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
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
  findAll(@Param('organizationId') organizationId: string) {
    return this.leagueSeasonService.findAll(organizationId);
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
