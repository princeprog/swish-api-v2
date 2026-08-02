import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizationMemberService } from './organization-member.service';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';
import { UpdateTeamAssignmentsDto } from './dto/update-assignments.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';

@Controller('organizations/:organizationId/members')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
export class OrganizationMemberController {
  constructor(
    private readonly organizationMemberService: OrganizationMemberService,
  ) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() createOrganizationMemberDto: CreateOrganizationMemberDto,
  ) {
    return this.organizationMemberService.create(
      organizationId,
      access,
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
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    return this.organizationMemberService.update(
      organizationId,
      memberId,
      access,
      updateOrganizationMemberDto,
    );
  }

  @Put(':memberId/team-assignments')
  updateTeamAssignments(
    @Param('organizationId') organizationId: string,
    @Param('memberId') memberId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updateTeamAssignmentsDto: UpdateTeamAssignmentsDto,
  ) {
    return this.organizationMemberService.updateTeamAssignments(
      organizationId,
      memberId,
      access,
      updateTeamAssignmentsDto.teamIds,
    );
  }
}
