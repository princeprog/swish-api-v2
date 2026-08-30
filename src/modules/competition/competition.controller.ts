import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ORGANIZATION_PERMISSIONS } from '../../common/auth/roles';
import { RequireOrganizationPermissions } from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompetitionService } from './competition.service';
import { GenerateCompetitionDto } from './dto/generate-competition.dto';
import { SetPoolAssignmentsDto } from './dto/set-pool-assignments.dto';
import { UpdateCompetitionFormatDto } from './dto/update-competition-format.dto';

@Controller(
  'organizations/:organizationId/divisions/:divisionId/competition',
)
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class CompetitionController {
  constructor(private readonly competitionService: CompetitionService) {}

  @Get()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  getWorkspace(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.competitionService.getWorkspace(organizationId, divisionId);
  }

  @Get('bracket')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.ORGANIZATION_READ)
  getBracket(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.competitionService.getBracket(organizationId, divisionId);
  }

  @Patch()
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  updateFormat(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Body() dto: UpdateCompetitionFormatDto,
  ) {
    return this.competitionService.updateFormat(
      organizationId,
      divisionId,
      dto,
    );
  }

  @Put('pools')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  setPoolAssignments(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Body() dto: SetPoolAssignmentsDto,
  ) {
    return this.competitionService.setPoolAssignments(
      organizationId,
      divisionId,
      dto,
    );
  }

  @Post('generate')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  generate(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Body() dto: GenerateCompetitionDto,
  ) {
    return this.competitionService.generate(organizationId, divisionId, dto);
  }

  @Post('reset')
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)
  reset(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
  ) {
    return this.competitionService.reset(organizationId, divisionId);
  }
}
