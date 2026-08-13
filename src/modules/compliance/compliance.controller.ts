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
import {
  RequireAnyOrganizationPermissions,
  RequireOrganizationPermissions,
} from '../../common/decorators/organization-permissions.decorator';
import { OrganizationPermissionsGuard } from '../../common/guards/organization-permissions.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ComplianceService } from './compliance.service';
import { ComplianceReviewQueryDto } from './dto/compliance-review-query.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { PrepareComplianceUploadDto } from './dto/prepare-compliance-upload.dto';
import { ReviewReasonDto } from './dto/review-reason.dto';
import { SaveComplianceDraftDto } from './dto/save-compliance-draft.dto';
import { SubmitComplianceRequirementDto } from './dto/submit-compliance-requirement.dto';
import { UpdateComplianceSettingsDto } from './dto/update-compliance-settings.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { WaiveRequirementDto } from './dto/waive-requirement.dto';

@Controller('organizations/:organizationId')
@UseGuards(JwtAuthGuard, OrganizationPermissionsGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get('divisions/:divisionId/compliance/settings')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  findSettings(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.findDivisionSettings(
      organizationId,
      divisionId,
      access,
    );
  }

  @Patch('divisions/:divisionId/compliance/settings')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  updateSettings(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: UpdateComplianceSettingsDto,
  ) {
    return this.complianceService.updateDivisionSettings(
      organizationId,
      divisionId,
      access,
      dto,
    );
  }

  @Post('divisions/:divisionId/compliance/requirements')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  createRequirement(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.complianceService.createRequirement(
      organizationId,
      divisionId,
      access,
      dto,
    );
  }

  @Patch('divisions/:divisionId/compliance/requirements/:requirementId')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  updateRequirement(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.complianceService.updateRequirement(
      organizationId,
      divisionId,
      requirementId,
      access,
      dto,
    );
  }

  @Delete('divisions/:divisionId/compliance/requirements/:requirementId')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  archiveRequirement(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.archiveRequirement(
      organizationId,
      divisionId,
      requirementId,
      access,
    );
  }

  @Post('divisions/:divisionId/compliance/publish')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
  )
  publish(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.publishDivision(
      organizationId,
      divisionId,
      access,
    );
  }

  @Get('divisions/:divisionId/compliance/overview')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  findOverview(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.findDivisionOverview(
      organizationId,
      divisionId,
      access,
    );
  }

  @Get('divisions/:divisionId/compliance/review-queue')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  findReviewQueue(
    @Param('organizationId') organizationId: string,
    @Param('divisionId') divisionId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Query() query: ComplianceReviewQueryDto,
  ) {
    return this.complianceService.findReviewQueue(
      organizationId,
      divisionId,
      access,
      query,
    );
  }

  @Get('teams/:teamId/compliance')
  @RequireAnyOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_READ_ASSIGNED,
  )
  findTeamCompliance(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.findTeamCompliance(
      organizationId,
      teamId,
      access,
    );
  }

  @Patch('teams/:teamId/compliance/requirements/:requirementId/draft')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  )
  saveDraft(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: SaveComplianceDraftDto,
  ) {
    return this.complianceService.saveDraft(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/submit')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  )
  submit(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: SubmitComplianceRequirementDto,
  ) {
    return this.complianceService.submitRequirement(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/uploads/prepare')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  )
  prepareUpload(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: PrepareComplianceUploadDto,
  ) {
    return this.complianceService.prepareUpload(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Post(
    'teams/:teamId/compliance/requirements/:requirementId/uploads/:fileId/complete',
  )
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  )
  completeUpload(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @Param('fileId') fileId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.completeUpload(
      organizationId,
      teamId,
      requirementId,
      access,
      fileId,
    );
  }

  @Delete(
    'teams/:teamId/compliance/requirements/:requirementId/uploads/:fileId',
  )
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  )
  deleteUpload(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @Param('fileId') fileId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.deleteUpload(
      organizationId,
      teamId,
      requirementId,
      access,
      fileId,
    );
  }

  @Post('teams/:teamId/compliance/files/:fileId/download-url')
  @RequireAnyOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_READ_ASSIGNED,
  )
  createDownloadUrl(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('fileId') fileId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.createDownloadUrl(
      organizationId,
      teamId,
      fileId,
      access,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/approve')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  approve(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.approve(
      organizationId,
      teamId,
      requirementId,
      access,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/request-changes')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  requestChanges(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: ReviewReasonDto,
  ) {
    return this.complianceService.requestChanges(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/waive')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  waive(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: WaiveRequirementDto,
  ) {
    return this.complianceService.waive(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Post('teams/:teamId/compliance/requirements/:requirementId/reopen')
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  )
  reopen(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
    @Body() dto: ReviewReasonDto,
  ) {
    return this.complianceService.reopen(
      organizationId,
      teamId,
      requirementId,
      access,
      dto,
    );
  }

  @Get('teams/:teamId/compliance/requirements/:requirementId/history')
  @RequireAnyOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_READ_ASSIGNED,
  )
  findHistory(
    @Param('organizationId') organizationId: string,
    @Param('teamId') teamId: string,
    @Param('requirementId') requirementId: string,
    @OrganizationAccess() access: OrganizationAccessContext,
  ) {
    return this.complianceService.findHistory(
      organizationId,
      teamId,
      requirementId,
      access,
    );
  }
}
