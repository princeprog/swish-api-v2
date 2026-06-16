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
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';
import { DivisionService } from './division.service';

@Controller('organizations/:organizationId/divisions')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class DivisionController {
  constructor(private readonly divisionService: DivisionService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createDivisionDto: CreateDivisionDto,
  ) {
    return this.divisionService.create(organizationId, createDivisionDto);
  }

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.divisionService.findAll(organizationId);
  }

  @Get(':divisionId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.divisionService.findOne(organizationId, divisionId);
  }

  @Patch(':divisionId')
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
  remove(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.divisionService.remove(organizationId, divisionId);
  }
}
