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
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';
import { DivisionService } from './division.service';

@Controller('organizations/:organizationId/divisions')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class DivisionController {
  constructor(private readonly divisionService: DivisionService) {}

  @Post()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE)
  create(
    @Param('organizationId') organizationId: string,
    @Body() createDivisionDto: CreateDivisionDto,
  ) {
    return this.divisionService.create(organizationId, createDivisionDto);
  }

  @Get()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findAll(
    @Param('organizationId') organizationId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.divisionService.findAll(organizationId, query);
  }

  @Get(':divisionId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.divisionService.findOne(organizationId, divisionId);
  }

  @Patch(':divisionId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE)
  update(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Body() updateDivisionDto: UpdateDivisionDto,
  ) {
    return this.divisionService.update(
      organizationId,
      divisionId,
      updateDivisionDto,
    );
  }

  @Delete(':divisionId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE)
  remove(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.divisionService.remove(organizationId, divisionId);
  }
}
