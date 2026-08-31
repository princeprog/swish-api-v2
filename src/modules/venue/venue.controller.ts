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
import { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { VenueService } from './venue.service';

@Controller('organizations/:organizationId/venues')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.VENUES_MANAGE)
export class VenueController {
  constructor(private readonly venueService: VenueService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createVenueDto: CreateVenueDto,
  ) {
    return this.venueService.create(organizationId, createVenueDto);
  }

  @Get()
  findAll(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.venueService.findAll(organizationId, query);
  }

  @Get(':venueId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('venueId') venueId: string,
  ) {
    return this.venueService.findOne(organizationId, venueId);
  }

  @Patch(':venueId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('venueId') venueId: string,
    @Body() updateVenueDto: UpdateVenueDto,
  ) {
    return this.venueService.update(organizationId, venueId, updateVenueDto);
  }

  @Delete(':venueId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('venueId') venueId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.venueService.remove(organizationId, venueId, access);
  }

  @Post(':venueId/archive')
  archive(
    @Param('organizationId') organizationId: string,
    @Param('venueId') venueId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.venueService.archive(organizationId, venueId, access);
  }

  @Post(':venueId/restore')
  restore(
    @Param('organizationId') organizationId: string,
    @Param('venueId') venueId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.venueService.restore(organizationId, venueId, access);
  }
}
