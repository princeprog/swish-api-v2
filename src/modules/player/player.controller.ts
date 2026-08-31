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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePlayerDto } from './dto/create-player.dto';
import { PlayerListQueryDto } from './dto/player-list-query.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { PlayerService } from './player.service';

@Controller('organizations/:organizationId/players')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  create(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() createPlayerDto: CreatePlayerDto,
  ) {
    return this.playerService.create(organizationId, access, createPlayerDto);
  }

  @Get()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findAll(
    @Param('organizationId') organizationId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: PlayerListQueryDto,
  ) {
    return this.playerService.findAll(organizationId, access, query);
  }

  @Get(':playerId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.playerService.findOne(organizationId, playerId, access);
  }

  @Patch(':playerId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  update(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() updatePlayerDto: UpdatePlayerDto,
  ) {
    return this.playerService.update(
      organizationId,
      playerId,
      access,
      updatePlayerDto,
    );
  }

  @Delete(':playerId')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
  remove(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.playerService.remove(organizationId, playerId, access);
  }

  @Post(':playerId/archive')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
  archive(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.playerService.archive(organizationId, playerId, access);
  }

  @Post(':playerId/restore')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
  restore(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.playerService.restore(organizationId, playerId, access);
  }
}
