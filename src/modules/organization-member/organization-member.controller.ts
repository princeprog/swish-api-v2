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
import { OrganizationMemberService } from './organization-member.service';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Controller('organizations/:organizationId/members')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class OrganizationMemberController {
  constructor(
    private readonly organizationMemberService: OrganizationMemberService,
  ) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createOrganizationMemberDto: CreateOrganizationMemberDto,
  ) {
    return this.organizationMemberService.create(
      organizationId,
      createOrganizationMemberDto,
    );
  }

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.organizationMemberService.findAll(organizationId);
  }

  @Get(':memberId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.organizationMemberService.findOne(organizationId, memberId);
  }

  @Patch(':memberId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @Body() updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    return this.organizationMemberService.update(
      organizationId,
      memberId,
      updateOrganizationMemberDto,
    );
  }

  @Delete(':memberId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.organizationMemberService.remove(organizationId, memberId);
  }
}
