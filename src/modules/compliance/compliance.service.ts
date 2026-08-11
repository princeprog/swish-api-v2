import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import type { CreateRequirementDto } from './dto/create-requirement.dto';
import type { ReviewReasonDto } from './dto/review-reason.dto';
import type { SaveComplianceDraftDto } from './dto/save-compliance-draft.dto';
import type { UpdateComplianceSettingsDto } from './dto/update-compliance-settings.dto';
import type { UpdateRequirementDto } from './dto/update-requirement.dto';
import type { WaiveRequirementDto } from './dto/waive-requirement.dto';
import {
  calculateTeamClearance,
  ensureReviewerActionAllowed,
  ensureSubmissionCanBeChanged,
  validateComplianceResponse,
  type ComplianceResponseType,
  type ComplianceSettingsStatus,
  type ComplianceWorkflowStatus,
} from './compliance-policy';
import { ComplianceRepository } from './compliance.repository';
import {
  COMPLIANCE_STORAGE,
  PlaceholderComplianceStorage,
  type ComplianceStorageBoundary,
} from './compliance-storage';

type SettingsRecord = NonNullable<
  Awaited<ReturnType<ComplianceRepository['findSettingsByDivision']>>
>;

@Injectable()
export class ComplianceService {
  constructor(
    private readonly repository: ComplianceRepository,
    @Optional()
    @Inject(COMPLIANCE_STORAGE)
    private readonly storage: ComplianceStorageBoundary = new PlaceholderComplianceStorage(),
  ) {}

  async findDivisionSettings(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanManage(access);
    await this.assertDivision(organizationId, divisionId);
    const settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings) {
      return { requirements: [], settings: null };
    }
    return {
      requirements: await this.repository.listRequirements(settings.id, true),
      settings,
    };
  }

  async updateDivisionSettings(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
    dto: UpdateComplianceSettingsDto,
  ) {
    this.assertCanManage(access);
    await this.assertDivision(organizationId, divisionId);
    let settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings) {
      settings = await this.repository.createSettings(
        divisionId,
        access.membershipId,
      );
    }

    if (!dto.status || dto.status === settings.status) {
      return settings;
    }
    if (dto.status === 'draft') {
      throw new BadRequestException(
        'Published or archived compliance settings cannot return to draft.',
      );
    }
    if (settings.status === 'archived') {
      throw new BadRequestException(
        'Archived compliance settings cannot be changed.',
      );
    }

    const updated = await this.repository.withTransaction(async (trx) => {
      const now = new Date();
      const changed = await trx.updateSettings(settings.id, {
        archived_at: now,
        published_at: settings.published_at ?? now,
        status: 'archived',
        updated_at: now,
      });
      await this.recalculateSettings(trx, changed);
      await trx.writeAudit(
        access,
        'compliance.settings.archived',
        'division',
        divisionId,
        {},
      );
      return changed;
    });
    return updated;
  }

  async createRequirement(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
    dto: CreateRequirementDto,
  ) {
    this.assertCanManage(access);
    await this.assertDivision(organizationId, divisionId);
    let settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings) {
      settings = await this.repository.createSettings(
        divisionId,
        access.membershipId,
      );
    }
    if (settings.status === 'archived') {
      throw new BadRequestException(
        'Archived compliance settings cannot accept new requirements.',
      );
    }

    return this.repository.withTransaction(async (trx) => {
      const requirement = await trx.createRequirement(settings.id, dto);
      if (settings.status === 'published') {
        await this.ensureObligations(trx, settings);
        await this.recalculateSettings(trx, settings);
      }
      await trx.writeAudit(
        access,
        'compliance.requirement.created',
        'compliance_requirement',
        requirement.id,
        { divisionId },
      );
      return requirement;
    });
  }

  async updateRequirement(
    organizationId: string,
    divisionId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: UpdateRequirementDto,
  ) {
    this.assertCanManage(access);
    const context = await this.requirementContext(
      organizationId,
      divisionId,
      requirementId,
    );
    if (context.settings.status === 'archived') {
      throw new BadRequestException(
        'Archived compliance settings cannot be changed.',
      );
    }

    return this.repository.withTransaction(async (trx) => {
      const requirement = await trx.updateRequirement(requirementId, {
        instructions: dto.instructions,
        is_required: dto.isRequired,
        max_file_count: dto.maxFileCount,
        response_type: dto.responseType,
        sort_order: dto.sortOrder,
        title: dto.title,
        updated_at: new Date(),
      });
      if (context.settings.status === 'published') {
        await this.ensureObligations(trx, context.settings);
        await this.recalculateSettings(trx, context.settings);
      }
      await trx.writeAudit(
        access,
        'compliance.requirement.updated',
        'compliance_requirement',
        requirementId,
        {},
      );
      return requirement;
    });
  }

  async archiveRequirement(
    organizationId: string,
    divisionId: string,
    requirementId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanManage(access);
    const context = await this.requirementContext(
      organizationId,
      divisionId,
      requirementId,
    );
    if (context.requirement.archived_at) {
      return context.requirement;
    }
    return this.repository.withTransaction(async (trx) => {
      const requirement = await trx.updateRequirement(requirementId, {
        archived_at: new Date(),
        updated_at: new Date(),
      });
      await this.recalculateSettings(trx, context.settings);
      await trx.writeAudit(
        access,
        'compliance.requirement.archived',
        'compliance_requirement',
        requirementId,
        {},
      );
      return requirement;
    });
  }

  async publishDivision(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanManage(access);
    await this.assertDivision(organizationId, divisionId);
    const settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings) {
      throw new BadRequestException(
        'Add at least one compliance requirement before publishing.',
      );
    }
    if (settings.status !== 'draft') {
      throw new BadRequestException(
        settings.status === 'published'
          ? 'These compliance requirements are already published.'
          : 'Archived compliance requirements cannot be published.',
      );
    }
    const requirements = await this.repository.listRequirements(settings.id);
    if (requirements.length === 0) {
      throw new BadRequestException(
        'Add at least one compliance requirement before publishing.',
      );
    }

    return this.repository.withTransaction(async (trx) => {
      const published = await trx.updateSettings(settings.id, {
        published_at: new Date(),
        status: 'published',
        updated_at: new Date(),
      });
      await this.ensureObligations(trx, published);
      await this.recalculateSettings(trx, published);
      await trx.writeAudit(
        access,
        'compliance.settings.published',
        'division',
        divisionId,
        {},
      );
      return published;
    });
  }

  async findDivisionOverview(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanReview(access);
    await this.assertDivision(organizationId, divisionId);
    const settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings) {
      return {
        counts: { not_required: 0, pending: 0, blocked: 0, cleared: 0 },
        settings: null,
      };
    }
    await this.repository.withTransaction((trx) =>
      this.recalculateSettings(trx, settings),
    );
    const projections = await this.repository.listProjections(settings.id);
    const counts = { not_required: 0, pending: 0, blocked: 0, cleared: 0 };
    for (const projection of projections) {
      counts[projection.status as keyof typeof counts] += 1;
    }
    return { counts, settings };
  }

  async findReviewQueue(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
    query: PaginationQueryDto & { status?: string },
  ) {
    this.assertCanReview(access);
    await this.assertDivision(organizationId, divisionId);
    const pagination = normalizePagination(query);
    const result = await this.repository.listReviewQueue(
      divisionId,
      query.status,
      pagination,
    );
    return createPaginatedResponse(result.data, result.total, pagination);
  }

  async findTeamCompliance(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
  ) {
    const team = await this.teamContext(organizationId, teamId);
    await this.assertCanReadTeam(access, teamId);
    const settings = await this.repository.findSettingsByDivision(
      team.division_id,
    );
    if (!settings) {
      return {
        clearance: { status: 'not_required' },
        requirements: [],
        settings: null,
        team,
      };
    }
    if (settings.status === 'published' && team.team_status === 'active') {
      await this.repository.withTransaction(async (trx) => {
        await this.ensureTeamObligations(trx, settings, teamId);
        await this.recalculateSettings(trx, settings);
      });
    }
    return {
      clearance: await this.repository.findProjection(teamId, settings.id),
      requirements: await this.repository.listTeamSubmissions(
        teamId,
        settings.id,
      ),
      settings,
      team,
    };
  }

  async saveDraft(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: SaveComplianceDraftDto,
  ) {
    await this.assertCanSubmitTeam(access, teamId);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureSubmissionCanBeChanged(
      submission.workflow_status as ComplianceWorkflowStatus,
    );
    validateComplianceResponse({
      isRequired: context.requirement.is_required,
      maxFileCount: context.requirement.max_file_count,
      response: dto.response,
      responseType: context.requirement.response_type as ComplianceResponseType,
    });
    if (context.requirement.response_type === 'file') {
      await this.storage.assertFileReferences(dto.response);
    }
    await this.repository.addEvent({
      actor_member_id: access.membershipId,
      event_type: 'draft_saved',
      metadata: {
        response: dto.response,
        responseType: context.requirement.response_type,
      },
      submission_attempt_id: null,
      submission_id: submission.id,
    });
    return { saved: true };
  }

  async submitRequirement(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
  ) {
    await this.assertCanSubmitTeam(access, teamId);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureSubmissionCanBeChanged(
      submission.workflow_status as ComplianceWorkflowStatus,
    );
    const draft = await this.repository.findLatestDraftEvent(submission.id);
    const response = readDraftResponse(draft?.metadata);
    validateComplianceResponse({
      isRequired: context.requirement.is_required,
      maxFileCount: context.requirement.max_file_count,
      response,
      responseType: context.requirement.response_type as ComplianceResponseType,
    });
    if (context.requirement.response_type === 'file') {
      await this.storage.assertFileReferences(response);
    }

    return this.repository.withTransaction(async (trx) => {
      const attemptNumber = (await trx.countAttempts(submission.id)) + 1;
      const attempt = await trx.createAttempt({
        attempt_number: attemptNumber,
        response_type: context.requirement.response_type,
        response_value: response ?? { skipped: true },
        submission_id: submission.id,
        submitted_by_member_id: access.membershipId,
      });
      const submitted = await trx.updateSubmission(submission.id, {
        current_attempt_id: attempt.id,
        review_note: null,
        reviewed_at: null,
        reviewed_by_member_id: null,
        submitted_at: attempt.submitted_at,
        submitted_by_member_id: access.membershipId,
        updated_at: new Date(),
        waived_at: null,
        waived_by_member_id: null,
        waiver_expires_at: null,
        waiver_reason: null,
        workflow_status: 'submitted',
      });
      await trx.addEvent({
        actor_member_id: access.membershipId,
        event_type: 'submitted',
        metadata: { attemptNumber },
        submission_attempt_id: attempt.id,
        submission_id: submission.id,
      });
      await this.recalculateSettings(trx, context.settings);
      await trx.writeAudit(
        access,
        'compliance.submission.submitted',
        'compliance_submission',
        submission.id,
        { attemptNumber },
      );
      return submitted;
    });
  }

  approve(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
  ) {
    return this.reviewDecision(
      organizationId,
      teamId,
      requirementId,
      access,
      'approve',
    );
  }

  requestChanges(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: ReviewReasonDto,
  ) {
    return this.reviewDecision(
      organizationId,
      teamId,
      requirementId,
      access,
      'request_changes',
      dto.reason,
    );
  }

  async waive(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: WaiveRequirementDto,
  ) {
    this.assertCanReview(access);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureReviewerActionAllowed(
      submission.workflow_status as ComplianceWorkflowStatus,
      'waive',
    );
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Choose a waiver expiry time in the future.',
      );
    }
    return this.repository.withTransaction(async (trx) => {
      const now = new Date();
      const updated = await trx.updateSubmission(submission.id, {
        review_note: null,
        reviewed_at: now,
        reviewed_by_member_id: access.membershipId,
        updated_at: now,
        waived_at: now,
        waived_by_member_id: access.membershipId,
        waiver_expires_at: expiresAt,
        waiver_reason: dto.reason,
        workflow_status: 'waived',
      });
      await trx.addEvent({
        actor_member_id: access.membershipId,
        event_type: 'waived',
        metadata: { expiresAt, reason: dto.reason },
        submission_attempt_id: submission.current_attempt_id,
        submission_id: submission.id,
      });
      await this.recalculateSettings(trx, context.settings);
      await trx.writeAudit(
        access,
        'compliance.submission.waived',
        'compliance_submission',
        submission.id,
        { expiresAt, reason: dto.reason },
      );
      return updated;
    });
  }

  async reopen(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: ReviewReasonDto,
  ) {
    this.assertCanReview(access);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureReviewerActionAllowed(
      submission.workflow_status as ComplianceWorkflowStatus,
      'reopen',
    );
    return this.repository.withTransaction(async (trx) => {
      const updated = await trx.updateSubmission(submission.id, {
        review_note: dto.reason,
        reviewed_at: new Date(),
        reviewed_by_member_id: access.membershipId,
        updated_at: new Date(),
        waived_at: null,
        waived_by_member_id: null,
        waiver_expires_at: null,
        waiver_reason: null,
        workflow_status: 'reopened',
      });
      await trx.addEvent({
        actor_member_id: access.membershipId,
        event_type: 'reopened',
        metadata: { reason: dto.reason },
        submission_attempt_id: submission.current_attempt_id,
        submission_id: submission.id,
      });
      await this.recalculateSettings(trx, context.settings);
      await trx.writeAudit(
        access,
        'compliance.submission.reopened',
        'compliance_submission',
        submission.id,
        { reason: dto.reason },
      );
      return updated;
    });
  }

  async findHistory(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
  ) {
    await this.teamRequirementContext(organizationId, teamId, requirementId);
    await this.assertCanReadTeam(access, teamId);
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    const [attempts, events] = await Promise.all([
      this.repository.listAttempts(submission.id),
      this.repository.listEvents(submission.id),
    ]);
    return { attempts, events };
  }

  private async reviewDecision(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    action: 'approve' | 'request_changes',
    reason?: string,
  ) {
    this.assertCanReview(access);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureReviewerActionAllowed(
      submission.workflow_status as ComplianceWorkflowStatus,
      action,
    );
    return this.repository.withTransaction(async (trx) => {
      const now = new Date();
      const workflowStatus = action === 'approve' ? 'approved' : 'rejected';
      const updated = await trx.updateSubmission(submission.id, {
        review_note: reason ?? null,
        reviewed_at: now,
        reviewed_by_member_id: access.membershipId,
        updated_at: now,
        workflow_status: workflowStatus,
      });
      await trx.addEvent({
        actor_member_id: access.membershipId,
        event_type: action === 'approve' ? 'approved' : 'changes_requested',
        metadata: reason ? { reason } : {},
        submission_attempt_id: submission.current_attempt_id,
        submission_id: submission.id,
      });
      await this.recalculateSettings(trx, context.settings);
      await trx.writeAudit(
        access,
        `compliance.submission.${workflowStatus}`,
        'compliance_submission',
        submission.id,
        reason ? { reason } : {},
      );
      return updated;
    });
  }

  private async ensureObligations(
    repository: ComplianceRepository,
    settings: SettingsRecord,
  ) {
    const teams = await repository.listActiveTeams(settings.division_id);
    const requirements = await repository.listRequirements(settings.id);
    for (const team of teams) {
      for (const requirement of requirements) {
        await repository.ensureSubmission(team.id, requirement.id);
      }
    }
  }

  private async ensureTeamObligations(
    repository: ComplianceRepository,
    settings: SettingsRecord,
    teamId: string,
  ) {
    const requirements = await repository.listRequirements(settings.id);
    for (const requirement of requirements) {
      await repository.ensureSubmission(teamId, requirement.id);
    }
  }

  private async recalculateSettings(
    repository: ComplianceRepository,
    settings: SettingsRecord,
  ) {
    const [teams, requirements, submissions] = await Promise.all([
      repository.listActiveTeams(settings.division_id),
      repository.listRequirements(settings.id),
      repository.listSubmissionsForSettings(settings.id),
    ]);
    for (const team of teams) {
      const clearance = calculateTeamClearance({
        now: new Date(),
        requirements: requirements.map((item) => ({
          id: item.id,
          isRequired: item.is_required,
        })),
        settingsStatus: settings.status as ComplianceSettingsStatus,
        submissions: submissions
          .filter((item) => item.team_id === team.id)
          .map((item) => ({
            requirementId: item.requirement_id,
            status: item.workflow_status as ComplianceWorkflowStatus,
            waiverExpiresAt: item.waiver_expires_at,
          })),
      });
      await repository.upsertProjection(team.id, settings.id, clearance);
    }
  }

  private async requirementContext(
    organizationId: string,
    divisionId: string,
    requirementId: string,
  ) {
    await this.assertDivision(organizationId, divisionId);
    const settings = await this.repository.findSettingsByDivision(divisionId);
    if (!settings)
      throw new NotFoundException('Compliance settings not found.');
    const requirement = await this.repository.findRequirement(
      settings.id,
      requirementId,
    );
    if (!requirement)
      throw new NotFoundException('Compliance requirement not found.');
    return { requirement, settings };
  }

  private async teamRequirementContext(
    organizationId: string,
    teamId: string,
    requirementId: string,
  ) {
    const team = await this.teamContext(organizationId, teamId);
    const settings = await this.repository.findSettingsByDivision(
      team.division_id,
    );
    if (!settings)
      throw new NotFoundException('Compliance settings not found.');
    const requirement = await this.repository.findRequirement(
      settings.id,
      requirementId,
    );
    if (!requirement || requirement.archived_at)
      throw new NotFoundException('Compliance requirement not found.');
    return { requirement, settings, team };
  }

  private async assertDivision(organizationId: string, divisionId: string) {
    const division = await this.repository.findDivisionContext(
      organizationId,
      divisionId,
    );
    if (!division) throw new NotFoundException('Division not found.');
    return division;
  }

  private async teamContext(organizationId: string, teamId: string) {
    const team = await this.repository.findTeamContext(organizationId, teamId);
    if (!team) throw new NotFoundException('Team not found.');
    return team;
  }

  private assertCanManage(access: OrganizationAccessContext) {
    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
      )
    ) {
      throw new ForbiddenException(
        'You cannot manage compliance requirements.',
      );
    }
  }

  private assertCanReview(access: OrganizationAccessContext) {
    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
      )
    ) {
      throw new ForbiddenException('You cannot review compliance submissions.');
    }
  }

  private async assertCanReadTeam(
    access: OrganizationAccessContext,
    teamId: string,
  ) {
    if (
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
      )
    )
      return;
    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_READ_ASSIGNED,
      ) ||
      !(await this.repository.isAssignedTeam(access.membershipId, teamId))
    ) {
      throw new ForbiddenException('You cannot view compliance for this team.');
    }
  }

  private async assertCanSubmitTeam(
    access: OrganizationAccessContext,
    teamId: string,
  ) {
    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
      ) ||
      !(await this.repository.isAssignedTeam(access.membershipId, teamId))
    ) {
      throw new ForbiddenException(
        'You cannot submit compliance requirements for this team.',
      );
    }
  }
}

function readDraftResponse(metadata: unknown): unknown {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    'response' in metadata
  ) {
    return metadata.response;
  }
  return null;
}
