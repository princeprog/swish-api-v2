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
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { PlayerService } from './player.service';

@Controller('organizations/:organizationId/players')
@UseGuards(JwtAuthGuard, OrganizationRolesGuard)
@OrganizationRoles(AUTH_ROLES.OWNER, AUTH_ROLES.ADMIN)
export class PlayerController {
  constructor(private readonly playerService: PlayerService) {}

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() createPlayerDto: CreatePlayerDto,
  ) {
    return this.playerService.create(organizationId, createPlayerDto);
  }

  @Get()
  findAll(@Param('organizationId') organizationId: string) {
    return this.playerService.findAll(organizationId);
  }

  @Get(':playerId')
  findOne(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
  ) {
    return this.playerService.findOne(organizationId, playerId);
  }

  @Patch(':playerId')
  update(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
    @Body() updatePlayerDto: UpdatePlayerDto,
  ) {
    return this.playerService.update(organizationId, playerId, updatePlayerDto);
  }

  @Delete(':playerId')
  remove(
    @Param('organizationId') organizationId: string,
    @Param('playerId') playerId: string,
  ) {
    return this.playerService.remove(organizationId, playerId);
  }
}
