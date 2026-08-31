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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationService } from './organization.service';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  create(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.organizationService.create(createOrganizationDto, user.id);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.organizationService.findAll(user.id);
  }

  @Get(':organizationId')
  @UseGuards(OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findOne(@Param('organizationId') organizationId: string) {
    return this.organizationService.findOne(organizationId);
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_MANAGE)
  update(
    @Param('organizationId') organizationId: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationService.update(
      organizationId,
      updateOrganizationDto,
    );
  }

  @Delete(':organizationId')
  @UseGuards(OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_MANAGE)
  remove(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.organizationService.remove(organizationId, access);
  }

  @Post(':organizationId/archive')
  @UseGuards(OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_MANAGE)
  archive(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.organizationService.archive(organizationId, access);
  }

  @Post(':organizationId/restore')
  @UseGuards(OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_MANAGE)
  restore(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.organizationService.restore(organizationId, access);
  }
}
