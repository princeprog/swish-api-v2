import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AUTH_ROLES } from '../../common/auth/roles';
import { OrganizationRoles } from '../../common/decorators/organization-roles.decorator';
import { OrganizationRolesGuard } from '../../common/guards/organization-roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StandingsQueryDto } from './dto/standings-query.dto';
import { StandingsService } from './standings.service';

@Controller('organizations/:organizationId/standings')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class StandingsController {
  constructor(private readonly standingsService: StandingsService) {}

  @Get()
  findAll(
    @Param('organizationId') organizationId: string,
    @Query() query: StandingsQueryDto,
  ) {
    return this.standingsService.findAll(organizationId, query);
  }
}
