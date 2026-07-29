import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { OrganizationMemberService } from './organization-member.service';

@Controller('organizations/:organizationId/ownership')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_TRANSFER)
export class OwnershipController {
  constructor(
    private readonly organizationMemberService: OrganizationMemberService,
  ) {}

  @Post('transfer')
  transfer(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() transferOwnershipDto: TransferOwnershipDto,
  ) {
    return this.organizationMemberService.transferOwnership(
      organizationId,
      access,
      transferOwnershipDto,
    );
  }
}
