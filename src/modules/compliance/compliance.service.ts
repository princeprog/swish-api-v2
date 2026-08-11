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
import type { PrepareComplianceUploadDto } from './dto/prepare-compliance-upload.dto';
import type { ReviewReasonDto } from './dto/review-reason.dto';
import type { SaveComplianceDraftDto } from './dto/save-compliance-draft.dto';
import type { UpdateComplianceSettingsDto } from './dto/update-compliance-settings.dto';
import type { UpdateRequirementDto } from './dto/update-requirement.dto';
import type { WaiveRequirementDto } from './dto/waive-requirement.dto';
import { NotificationWriter } from '../notification/notification.writer';
import type { NotificationEventType } from '../notification/notification.events';
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
    @Optional() private readonly notificationWriter?: NotificationWriter,
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

    if (settings.status === 'archived') {
      throw new BadRequestException(
        'Archived compliance settings cannot be changed.',
      );
    }
    if (dto.status === 'draft' && settings.status !== 'draft') {
      throw new BadRequestException(
        'Published or archived compliance settings cannot return to draft.',
      );
    }

    const values: Record<string, unknown> = {
      updated_at: new Date(),
    };
    if (dto.instructions !== undefined) {
      values.instructions = dto.instructions?.trim() || null;
    }
    if (dto.submissionDeadlineAt !== undefined) {
      values.submission_deadline_at = dto.submissionDeadlineAt
        ? new Date(dto.submissionDeadlineAt)
        : null;
    }

    if (dto.status === 'archived') {
      const now = new Date();
      values.archived_at = now;
      values.published_at = settings.published_at ?? now;
      values.status = 'archived';
    }

    if (Object.keys(values).length === 1) {
      return settings;
    }

    const updated = await this.repository.withTransaction(async (trx) => {
      const changed = await trx.updateSettings(settings.id, values);
      if (changed.status === 'archived') {
        await this.recalculateSettings(trx, changed);
      }
      await trx.writeAudit(
        access,
        changed.status === 'archived'
          ? 'compliance.settings.archived'
          : 'compliance.settings.updated',
        'division',
        divisionId,
        {
          instructionsChanged: dto.instructions !== undefined,
          deadlineChanged: dto.submissionDeadlineAt !== undefined,
        },
      );
      return changed;
    });
    if (
      settings.status === 'published' &&
      updated.status === 'published' &&
      (dto.instructions !== undefined || dto.submissionDeadlineAt !== undefined)
    ) {
      await this.notifyDivisionManagers(
        divisionId,
        access,
        'compliance.requirements_changed',
        `compliance:settings:${settings.id}:changed:${updated.updated_at.toISOString()}`,
      );
    }
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

    const created = await this.repository.withTransaction(async (trx) => {
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
    if (settings.status === 'published') {
      await this.notifyDivisionManagers(
        divisionId,
        access,
        'compliance.requirements_changed',
        `compliance:requirements:${settings.id}:changed`,
      );
    }
    return created;
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

    const updated = await this.repository.withTransaction(async (trx) => {
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
    if (context.settings.status === 'published') {
      await this.notifyDivisionManagers(
        divisionId,
        access,
        'compliance.requirements_changed',
        `compliance:requirement:${requirementId}:changed:${updated.updated_at.toISOString()}`,
      );
    }
    return updated;
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
    const archived = await this.repository.withTransaction(async (trx) => {
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
    if (context.settings.status === 'published') {
      await this.notifyDivisionManagers(
        divisionId,
        access,
        'compliance.requirements_changed',
        `compliance:requirement:${requirementId}:archived`,
      );
    }
    return archived;
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

    const published = await this.repository.withTransaction(async (trx) => {
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
    await this.notifyDivisionManagers(
      divisionId,
      access,
      'compliance.requirements_published',
      `compliance:settings:${settings.id}:published`,
    );
    return published;
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
    if (!settings || settings.status !== 'published') {
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
    const requirements = await this.repository.listTeamSubmissions(
      teamId,
      settings.id,
    );
    const requirementsWithFiles = await Promise.all(
      requirements.map(async (requirement) => {
        const response = requirement.submission_id
          ? requirement.current_attempt_id
            ? (
                await this.repository.listAttempts(requirement.submission_id)
              ).find(
                (attempt) => attempt.id === requirement.current_attempt_id,
              )?.response_value ?? null
            : readDraftResponse(
                (
                  await this.repository.findLatestDraftEvent(
                    requirement.submission_id,
                  )
                )?.metadata,
              )
          : null;
        return {
          ...requirement,
          files: requirement.submission_id
            ? await this.repository.listFilesForSubmission(
                requirement.submission_id,
                requirement.current_attempt_id,
              )
            : [],
          response,
        };
      }),
    );
    return {
      clearance: await this.repository.findProjection(teamId, settings.id),
      requirements: requirementsWithFiles,
      settings,
      team,
    };
  }

  async checkGameStartClearance(input: {
    organizationId: string;
    divisionId: string | null;
    homeTeamId: string | null;
    homeTeamName: string | null;
    awayTeamId: string | null;
    awayTeamName: string | null;
  }) {
    if (!input.divisionId || !input.homeTeamId || !input.awayTeamId) {
      return { allowed: true, blockedTeams: [] };
    }
    await this.assertDivision(input.organizationId, input.divisionId);
    const settings = await this.repository.findSettingsByDivision(
      input.divisionId,
    );
    if (!settings || settings.status !== 'published') {
      return { allowed: true, blockedTeams: [] };
    }

    await this.repository.withTransaction((trx) =>
      this.recalculateSettings(trx, settings),
    );
    const projections = await Promise.all([
      this.repository.findProjection(input.homeTeamId, settings.id),
      this.repository.findProjection(input.awayTeamId, settings.id),
    ]);
    const names = [
      input.homeTeamName ?? 'Home team',
      input.awayTeamName ?? 'Away team',
    ];
    const blockedTeams = projections
      .map((projection, index) =>
        projection?.status === 'cleared'
          ? null
          : {
              name: names[index],
              status: projection?.status ?? 'pending',
            },
      )
      .filter(
        (team): team is { name: string; status: string } => team !== null,
      );
    return { allowed: blockedTeams.length === 0, blockedTeams };
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
      await this.storage.assertFileReferences(dto.response, {
        organizationId,
        requirementId,
        submissionId: submission.id,
        teamId,
      });
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
      await this.storage.assertFileReferences(response, {
        organizationId,
        requirementId,
        submissionId: submission.id,
        teamId,
      });
    }

    const submitted = await this.repository.withTransaction(async (trx) => {
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

    if (submitted.current_attempt_id) {
      await this.storage.attachFilesToAttempt(
        response,
        submission.id,
        submitted.current_attempt_id,
      );
    }
    await this.notifySubmissionReviewers(
      submission.id,
      access,
      'compliance.item_submitted',
      `compliance:submission:${submission.id}:attempt:${submitted.current_attempt_id ?? 'none'}`,
    );
    return submitted;
  }

  async prepareUpload(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    dto: PrepareComplianceUploadDto,
  ) {
    await this.assertCanSubmitTeam(access, teamId);
    const context = await this.teamRequirementContext(
      organizationId,
      teamId,
      requirementId,
    );
    if (context.settings.status !== 'published') {
      throw new BadRequestException(
        'Evidence uploads open after the league organizer publishes the requirements.',
      );
    }
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureSubmissionCanBeChanged(
      submission.workflow_status as ComplianceWorkflowStatus,
    );
    return this.storage.prepareUpload({
      ...dto,
      organizationId,
      requirementId,
      submissionId: submission.id,
      teamId,
    });
  }

  async completeUpload(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    fileId: string,
  ) {
    await this.assertCanSubmitTeam(access, teamId);
    await this.teamRequirementContext(organizationId, teamId, requirementId);
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureSubmissionCanBeChanged(
      submission.workflow_status as ComplianceWorkflowStatus,
    );
    return this.storage.completeUpload({
      fileId,
      organizationId,
      requirementId,
      submissionId: submission.id,
      teamId,
    });
  }

  async deleteUpload(
    organizationId: string,
    teamId: string,
    requirementId: string,
    access: OrganizationAccessContext,
    fileId: string,
  ) {
    await this.assertCanSubmitTeam(access, teamId);
    await this.teamRequirementContext(organizationId, teamId, requirementId);
    const submission = await this.repository.ensureSubmission(
      teamId,
      requirementId,
    );
    ensureSubmissionCanBeChanged(
      submission.workflow_status as ComplianceWorkflowStatus,
    );
    await this.storage.deleteUpload({
      fileId,
      organizationId,
      requirementId,
      submissionId: submission.id,
      teamId,
    });
    return { deleted: true };
  }

  async createDownloadUrl(
    organizationId: string,
    teamId: string,
    fileId: string,
    access: OrganizationAccessContext,
  ) {
    await this.assertCanReadTeam(access, teamId);
    await this.teamContext(organizationId, teamId);
    return this.storage.createDownloadUrl(fileId, { organizationId, teamId });
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
    const updated = await this.repository.withTransaction(async (trx) => {
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
    await this.notifySubmissionTeam(
      submission.id,
      access,
      'compliance.item_waived',
      `compliance:submission:${submission.id}:waived:${updated.updated_at.toISOString()}`,
      {
        deadlineLabel: expiresAt
          ? formatComplianceDeadline(expiresAt)
          : undefined,
      },
    );
    return updated;
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
    const updated = await this.repository.withTransaction(async (trx) => {
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
    await this.notifySubmissionTeam(
      submission.id,
      access,
      'compliance.item_reopened',
      `compliance:submission:${submission.id}:reopened:${updated.updated_at.toISOString()}`,
      { reviewNote: dto.reason },
    );
    return updated;
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
    const updated = await this.repository.withTransaction(async (trx) => {
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
    await this.notifySubmissionTeam(
      submission.id,
      access,
      action === 'approve'
        ? 'compliance.item_approved'
        : 'compliance.changes_requested',
      `compliance:submission:${submission.id}:${action}:${updated.updated_at.toISOString()}`,
      reason ? { reviewNote: reason } : undefined,
    );
    return updated;
  }

  private async notifyDivisionManagers(
    divisionId: string,
    access: OrganizationAccessContext,
    eventType: Extract<NotificationEventType, `compliance.${string}`>,
    dedupeKey: string,
  ) {
    if (!this.notificationWriter) return;
    const division =
      await this.repository.findDivisionNotificationContext(divisionId);
    if (!division) return;
    const teams = await this.repository.listActiveTeams(divisionId);
    const managerRows = await Promise.all(
      teams.map((team) => this.repository.findTeamManagerRecipients(team.id)),
    );
    const recipients = Array.from(
      new Set(managerRows.flat().map((row) => row.user_id)),
    ).map((userId) => ({ userId }));
    if (recipients.length === 0) return;
    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        divisionId,
        divisionName: division.division_name,
        organizationName: division.organization_name,
        organizationSlug: division.organization_slug,
      },
      dedupeKey,
      eventType,
      organizationId: division.organization_id,
      recipients,
      resourceId: divisionId,
      resourceType: 'division_compliance',
    });
  }

  private async notifySubmissionReviewers(
    submissionId: string,
    access: OrganizationAccessContext,
    eventType: Extract<NotificationEventType, `compliance.${string}`>,
    dedupeKey: string,
  ) {
    if (!this.notificationWriter) return;
    const context =
      await this.repository.findComplianceNotificationContext(submissionId);
    if (!context) return;
    const reviewerRows = await this.repository.findComplianceReviewers(
      context.organization_id,
    );
    const recipients = reviewerRows.map((row) => ({ userId: row.user_id }));
    if (recipients.length === 0) return;
    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        divisionId: context.division_id,
        divisionName: context.division_name,
        organizationName: context.organization_name,
        organizationSlug: context.organization_slug,
        requirementTitle: context.requirement_title,
        teamName: context.team_name,
      },
      dedupeKey,
      eventType,
      organizationId: context.organization_id,
      recipients,
      resourceId: submissionId,
      resourceType: 'compliance_submission',
    });
  }

  private async notifySubmissionTeam(
    submissionId: string,
    access: OrganizationAccessContext,
    eventType: Extract<NotificationEventType, `compliance.${string}`>,
    dedupeKey: string,
    extra: { deadlineLabel?: string; reviewNote?: string } = {},
  ) {
    if (!this.notificationWriter) return;
    const context =
      await this.repository.findComplianceNotificationContext(submissionId);
    if (!context) return;
    const managerRows = await this.repository.findTeamManagerRecipients(
      context.team_id,
    );
    const recipients = managerRows.map((row) => ({ userId: row.user_id }));
    if (recipients.length === 0) return;
    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        divisionId: context.division_id,
        divisionName: context.division_name,
        organizationName: context.organization_name,
        organizationSlug: context.organization_slug,
        requirementTitle: context.requirement_title,
        reviewNote: extra.reviewNote,
        teamId: context.team_id,
        teamName: context.team_name,
        deadlineLabel: extra.deadlineLabel,
      },
      dedupeKey,
      eventType,
      organizationId: context.organization_id,
      recipients,
      resourceId: submissionId,
      resourceType: 'compliance_submission',
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

function formatComplianceDeadline(value: Date): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(value);
}
