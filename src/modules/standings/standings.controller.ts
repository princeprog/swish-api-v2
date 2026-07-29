import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StandingsQueryDto } from './dto/standings-query.dto';
import { StandingsService } from './standings.service';

@Controller('organizations/:organizationId/standings')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(
  ORGANIZATION_PERMISSIONS.STANDINGS_READ_ASSIGNED_DIVISION,
)
export class StandingsController {
  constructor(private readonly standingsService: StandingsService) {}

  @Get()
  findAll(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: StandingsQueryDto,
  ) {
    return this.standingsService.findAll(organizationId, access, query);
  }
}
