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
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { UpdateInvitationDto } from './dto/update-invitation.dto';
import { InvitationService } from './invitation.service';

@Controller()
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @Post('organizations/:organizationId/invitations')
  @UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
  create(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() createInvitationDto: CreateInvitationDto,
  ) {
    return this.invitationService.create(
      organizationId,
      access,
      createInvitationDto,
    );
  }

  @Get('organizations/:organizationId/invitations')
  @UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
  findAll(@Param('organizationId') organizationId: string) {
    return this.invitationService.findAll(organizationId);
  }

  @Post('organizations/:organizationId/invitations/:invitationId/resend')
  @UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
  resend(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.invitationService.resend(organizationId, invitationId, access);
  }

  @Patch('organizations/:organizationId/invitations/:invitationId')
  @UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
  update(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updateInvitationDto: UpdateInvitationDto,
  ) {
    return this.invitationService.update(
      organizationId,
      invitationId,
      access,
      updateInvitationDto,
    );
  }

  @Delete('organizations/:organizationId/invitations/:invitationId')
  @UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.MEMBERS_MANAGE)
  revoke(
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.invitationService.revoke(organizationId, invitationId, access);
  }

  @Get('invitations/preview')
  preview(@Query('token') token: string) {
    return this.invitationService.preview(token);
  }

  @Post('invitations/accept')
  @UseGuards(JwtAuthGuard)
  accept(
    @Body() acceptInvitationDto: AcceptInvitationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invitationService.accept(acceptInvitationDto, user);
  }
}
