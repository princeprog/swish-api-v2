import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { OrganizationAccess } from '../../common/decorators/organization-access.decorator';
import { RequireAnyOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ClaimScoringControlDto,
  ScoringCommandDto,
  ScoringControlTokenDto,
  ScoringEventsQueryDto,
  TakeoverScoringControlDto,
} from './dto/scoring-command.dto';
import type { ScoringCommand } from './scoring-engine';
import { ScoringService } from './scoring.service';

@Controller('organizations/:organizationId/games/:gameId/scoring')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireAnyOrganizationPermissions(
  ORGANIZATION_PERMISSIONS.GAME_SCORE_ASSIGNED,
  ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE,
)
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get()
  getState(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.scoringService.getState(organizationId, gameId, access);
  }

  @Get('events')
  listEvents(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: ScoringEventsQueryDto,
  ) {
    return this.scoringService.listEvents(organizationId, gameId, access, query);
  }

  @Post('control/claim')
  claimControl(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() body: ClaimScoringControlDto,
  ) {
    return this.scoringService.claimControl(
      organizationId,
      gameId,
      access,
      body.deviceLabel,
    );
  }

  @Post('control/heartbeat')
  heartbeatControl(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() body: ScoringControlTokenDto,
  ) {
    return this.scoringService.heartbeatControl(
      organizationId,
      gameId,
      access,
      body.controlToken,
    );
  }

  @Post('control/takeover')
  takeoverControl(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() body: TakeoverScoringControlDto,
  ) {
    return this.scoringService.takeoverControl(
      organizationId,
      gameId,
      access,
      body,
    );
  }

  @Delete('control')
  releaseControl(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() body: ScoringControlTokenDto,
  ) {
    return this.scoringService.releaseControl(
      organizationId,
      gameId,
      access,
      body.controlToken,
    );
  }

  @Post('commands')
  executeCommand(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() body: ScoringCommandDto,
  ) {
    return this.scoringService.executeCommand(organizationId, gameId, access, {
      command: {
        idempotencyKey: body.idempotencyKey,
        payload: body.payload,
        type: body.type,
      } as ScoringCommand,
      controlToken: body.controlToken,
      expectedVersion: body.expectedVersion,
      occurredAt: new Date(body.occurredAt),
    });
  }
}
