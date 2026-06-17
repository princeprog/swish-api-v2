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
import { OrganizationRoles } from '../../common/decorators/organization-roles.decorator';
import { AUTH_ROLES } from '../../common/auth/roles';
import { OrganizationRolesGuard } from '../../common/guards/organization-roles.guard';
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
  @UseGuards(OrganizationRolesGuard)
  @OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
  findOne(@Param('organizationId') organizationId: string) {
    return this.organizationService.findOne(organizationId);
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationRolesGuard)
  @OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
  update(
    @Param('organizationId') organizationId: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationService.update(organizationId, updateOrganizationDto);
  }

  @Delete(':organizationId')
  @UseGuards(OrganizationRolesGuard)
  @OrganizationRoles(AUTH_ROLES.OWNER)
  remove(@Param('organizationId') organizationId: string) {
    return this.organizationService.remove(organizationId);
  }
}
