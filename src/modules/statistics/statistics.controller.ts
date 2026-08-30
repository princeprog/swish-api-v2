import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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
  ClaimStatisticsControlDto,
  RecordStatisticEventDto,
  StatisticsControlTokenDto,
  StatisticsOverrideDto,
  SubmitStatisticsDto,
  TakeoverStatisticsControlDto,
} from './dto/statistics-command.dto';
import { StatisticsService } from './statistics.service';

@Controller('organizations/:organizationId/games/:gameId/statistics')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
@RequireAnyOrganizationPermissions(
  ORGANIZATION_PERMISSIONS.GAME_STATS_ASSIGNED,
  ORGANIZATION_PERMISSIONS.GAME_STATS_OVERRIDE,
)
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  getState(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.statisticsService.getState(organizationId, gameId, access);
  }

  @Post('control/claim')
  claimControl(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: ClaimStatisticsControlDto,
  ) {
    return this.statisticsService.claimControl(
      organizationId,
      gameId,
      access,
      dto.deviceLabel,
    );
  }

  @Post('control/heartbeat')
  heartbeat(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: StatisticsControlTokenDto,
  ) {
    return this.statisticsService.heartbeatControl(
      organizationId,
      gameId,
      access,
      dto.controlToken,
    );
  }

  @Post('control/takeover')
  takeover(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: TakeoverStatisticsControlDto,
  ) {
    return this.statisticsService.takeoverControl(
      organizationId,
      gameId,
      access,
      dto,
    );
  }

  @Delete('control')
  release(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: StatisticsControlTokenDto,
  ) {
    return this.statisticsService.releaseControl(
      organizationId,
      gameId,
      access,
      dto.controlToken,
    );
  }

  @Post('events')
  recordEvent(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: RecordStatisticEventDto,
  ) {
    return this.statisticsService.recordEvent(
      organizationId,
      gameId,
      access,
      dto,
    );
  }

  @Post('submit')
  submit(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: SubmitStatisticsDto,
  ) {
    return this.statisticsService.submit(
      organizationId,
      gameId,
      access,
      dto.controlToken,
    );
  }

  @Post('reconciliation/override')
  overrideReconciliation(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: StatisticsOverrideDto,
  ) {
    return this.statisticsService.overrideReconciliation(
      organizationId,
      gameId,
      access,
      dto.reason,
    );
  }

  @Post('reopen')
  reopen(
    @Param('organizationId') organizationId: string,
    @Param('gameId') gameId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: StatisticsOverrideDto,
  ) {
    return this.statisticsService.reopen(
      organizationId,
      gameId,
      access,
      dto.reason,
    );
  }
}
