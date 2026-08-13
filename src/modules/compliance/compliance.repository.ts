import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import type { NormalizedPagination } from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { CreateRequirementDto } from './dto/create-requirement.dto';
import type { ComplianceWorkflowStatus } from './compliance-policy';

const DISPLAYABLE_FILE_STATUSES = [
  'uploaded',
  'scanning',
  'verified',
  'rejected',
] as const;

@Injectable()
export class ComplianceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  withTransaction<T>(work: (repository: ComplianceRepository) => Promise<T>) {
    return this.db
      .transaction()
      .execute((trx) => work(new ComplianceRepository(trx as Database)));
  }

  findDivisionContext(organizationId: string, divisionId: string) {
    return this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'divisions.id as division_id',
        'divisions.name as division_name',
        'seasons.organization_id',
      ])
      .where('divisions.id', '=', divisionId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  findTeamContext(organizationId: string, teamId: string) {
    return this.db
      .selectFrom('admin.teams as teams')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'teams.id as team_id',
        'teams.name as team_name',
        'teams.status as team_status',
        'teams.division_id',
        'seasons.organization_id',
      ])
      .where('teams.id', '=', teamId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  async isAssignedTeam(memberId: string, teamId: string) {
    const assignment = await this.db
      .selectFrom('access.team_manager_assignments')
      .select('id')
      .where('organization_member_id', '=', memberId)
      .where('team_id', '=', teamId)
      .executeTakeFirst();
    return assignment !== undefined;
  }

  findSettingsByDivision(divisionId: string) {
    return this.db
      .selectFrom('compliance.division_settings')
      .selectAll()
      .where('division_id', '=', divisionId)
      .executeTakeFirst();
  }

  createSettings(divisionId: string, memberId: string) {
    return this.db
      .insertInto('compliance.division_settings')
      .values({ created_by_member_id: memberId, division_id: divisionId })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  updateSettings(id: string, values: Record<string, unknown>) {
    return this.db
      .updateTable('compliance.division_settings')
      .set(values as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  listRequirements(settingsId: string, includeArchived = false) {
    let query = this.db
      .selectFrom('compliance.requirements')
      .selectAll()
      .where('division_settings_id', '=', settingsId);
    if (!includeArchived) query = query.where('archived_at', 'is', null);
    return query.orderBy('sort_order asc').orderBy('created_at asc').execute();
  }

  findRequirement(settingsId: string, requirementId: string) {
    return this.db
      .selectFrom('compliance.requirements')
      .selectAll()
      .where('division_settings_id', '=', settingsId)
      .where('id', '=', requirementId)
      .executeTakeFirst();
  }

  createRequirement(settingsId: string, dto: CreateRequirementDto) {
    return this.db
      .insertInto('compliance.requirements')
      .values({
        division_settings_id: settingsId,
        instructions: dto.instructions ?? null,
        is_required: dto.isRequired ?? true,
        max_file_count: dto.maxFileCount ?? 5,
        response_type: dto.responseType,
        sort_order: dto.sortOrder,
        title: dto.title,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  updateRequirement(id: string, values: Record<string, unknown>) {
    return this.db
      .updateTable('compliance.requirements')
      .set(values as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  listActiveTeams(divisionId: string) {
    return this.db
      .selectFrom('admin.teams')
      .select(['id'])
      .where('division_id', '=', divisionId)
      .where('status', '=', 'active')
      .execute();
  }

  async ensureSubmission(teamId: string, requirementId: string) {
    await this.db
      .insertInto('compliance.team_submissions')
      .values({ requirement_id: requirementId, team_id: teamId })
      .onConflict((oc) => oc.columns(['team_id', 'requirement_id']).doNothing())
      .execute();
    return this.getSubmission(teamId, requirementId);
  }

  getSubmission(teamId: string, requirementId: string) {
    return this.db
      .selectFrom('compliance.team_submissions')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('requirement_id', '=', requirementId)
      .executeTakeFirstOrThrow();
  }

  updateSubmission(id: string, values: Record<string, unknown>) {
    return this.db
      .updateTable('compliance.team_submissions')
      .set(values as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  createPendingFile(values: Record<string, unknown>) {
    return this.db
      .insertInto('compliance.submission_files')
      .values(values as never)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findFile(fileId: string) {
    return this.db
      .selectFrom('compliance.submission_files as files')
      .innerJoin(
        'compliance.team_submissions as submissions',
        'submissions.id',
        'files.submission_id',
      )
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'submissions.team_id')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'files.id',
        'files.file_order',
        'files.storage_provider',
        'files.storage_key',
        'files.original_filename',
        'files.mime_type',
        'files.byte_size',
        'files.sha256',
        'files.verification_status',
        'files.uploaded_at',
        'files.verified_at',
        'files.rejection_reason',
        'files.submission_id',
        'files.submission_attempt_id',
        'submissions.team_id',
        'submissions.requirement_id',
        'requirements.division_settings_id',
        'teams.division_id',
        'seasons.organization_id',
      ])
      .where('files.id', '=', fileId)
      .executeTakeFirst();
  }

  listFiles(fileIds: string[], submissionId: string) {
    if (fileIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('compliance.submission_files')
      .selectAll()
      .where('id', 'in', fileIds)
      .where('submission_id', '=', submissionId)
      .execute();
  }

  updateFile(id: string, values: Record<string, unknown>) {
    return this.db
      .updateTable('compliance.submission_files')
      .set(values as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  attachFilesToAttempt(
    fileIds: string[],
    submissionId: string,
    attemptId: string,
  ) {
    if (fileIds.length === 0) return Promise.resolve();
    return this.db
      .updateTable('compliance.submission_files')
      .set({ submission_attempt_id: attemptId, updated_at: new Date() })
      .where('id', 'in', fileIds)
      .where('submission_id', '=', submissionId)
      .where('verification_status', '=', 'verified')
      .execute()
      .then(() => undefined);
  }

  createFileScanJob(
    fileId: string,
    provider: string,
    result: Record<string, unknown>,
  ) {
    return this.db
      .insertInto('compliance.file_scan_jobs')
      .values({
        completed_at: new Date(),
        provider,
        result: result as never,
        status: 'passed',
        submission_file_id: fileId,
      })
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  deleteFile(id: string, submissionId: string) {
    return this.db
      .deleteFrom('compliance.submission_files')
      .where('id', '=', id)
      .where('submission_id', '=', submissionId)
      .execute();
  }

  countAttempts(submissionId: string) {
    return this.db
      .selectFrom('compliance.submission_attempts')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('submission_id', '=', submissionId)
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count));
  }

  createAttempt(values: Record<string, unknown>) {
    return this.db
      .insertInto('compliance.submission_attempts')
      .values(values as never)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  addEvent(values: Record<string, unknown>) {
    return this.db
      .insertInto('compliance.submission_events')
      .values(values as never)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findLatestDraftEvent(submissionId: string) {
    return this.db
      .selectFrom('compliance.submission_events')
      .selectAll()
      .where('submission_id', '=', submissionId)
      .where('event_type', '=', 'draft_saved')
      .orderBy('created_at desc')
      .executeTakeFirst();
  }

  listAttempts(submissionId: string) {
    return this.db
      .selectFrom('compliance.submission_attempts')
      .selectAll()
      .where('submission_id', '=', submissionId)
      .orderBy('attempt_number asc')
      .execute();
  }

  listEvents(submissionId: string) {
    return this.db
      .selectFrom('compliance.submission_events')
      .selectAll()
      .where('submission_id', '=', submissionId)
      .orderBy('created_at asc')
      .execute();
  }

  listSubmissionsForSettings(settingsId: string) {
    return this.db
      .selectFrom('compliance.team_submissions as submissions')
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .select([
        'submissions.team_id',
        'submissions.requirement_id',
        'submissions.workflow_status',
        'submissions.waiver_expires_at',
      ])
      .where('requirements.division_settings_id', '=', settingsId)
      .where('requirements.archived_at', 'is', null)
      .execute();
  }

  listTeamSubmissions(teamId: string, settingsId: string) {
    return this.db
      .selectFrom('compliance.requirements as requirements')
      .leftJoin('compliance.team_submissions as submissions', (join) =>
        join
          .onRef('submissions.requirement_id', '=', 'requirements.id')
          .on('submissions.team_id', '=', teamId),
      )
      .select([
        'requirements.id as requirement_id',
        'requirements.title',
        'requirements.instructions',
        'requirements.response_type',
        'requirements.is_required',
        'requirements.max_file_count',
        'requirements.sort_order',
        'submissions.id as submission_id',
        'submissions.current_attempt_id',
        'submissions.workflow_status',
        'submissions.review_note',
        'submissions.waiver_reason',
        'submissions.waiver_expires_at',
      ])
      .where('requirements.division_settings_id', '=', settingsId)
      .where('requirements.archived_at', 'is', null)
      .orderBy('requirements.sort_order asc')
      .execute();
  }

  listDraftFiles(submissionId: string) {
    return this.db
      .selectFrom('compliance.submission_files')
      .select(['id', 'original_filename', 'verification_status'])
      .where('submission_id', '=', submissionId)
      .where('submission_attempt_id', 'is', null)
      .where('verification_status', 'in', DISPLAYABLE_FILE_STATUSES)
      .orderBy('file_order asc')
      .execute();
  }

  listAttemptFiles(submissionId: string, attemptId: string) {
    return this.db
      .selectFrom('compliance.submission_files')
      .select(['id', 'original_filename', 'verification_status'])
      .where('submission_id', '=', submissionId)
      .where('submission_attempt_id', '=', attemptId)
      .where('verification_status', 'in', DISPLAYABLE_FILE_STATUSES)
      .orderBy('file_order asc')
      .execute();
  }

  upsertProjection(
    teamId: string,
    settingsId: string,
    clearance: {
      blockingRequirementCount: number;
      pendingRequirementCount: number;
      status: string;
    },
  ) {
    const now = new Date();
    return this.db
      .insertInto('compliance.team_clearance_projections')
      .values({
        blocking_requirement_count: clearance.blockingRequirementCount,
        division_settings_id: settingsId,
        last_evaluated_at: now,
        pending_requirement_count: clearance.pendingRequirementCount,
        status: clearance.status,
        team_id: teamId,
      })
      .onConflict((oc) =>
        oc.columns(['team_id', 'division_settings_id']).doUpdateSet((eb) => ({
          blocking_requirement_count: clearance.blockingRequirementCount,
          last_evaluated_at: now,
          pending_requirement_count: clearance.pendingRequirementCount,
          status: clearance.status,
          updated_at: now,
          version: eb(
            eb.ref('compliance.team_clearance_projections.version'),
            '+',
            1,
          ),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findProjection(teamId: string, settingsId: string) {
    return this.db
      .selectFrom('compliance.team_clearance_projections')
      .selectAll()
      .where('team_id', '=', teamId)
      .where('division_settings_id', '=', settingsId)
      .executeTakeFirst();
  }

  listProjections(settingsId: string) {
    return this.db
      .selectFrom('compliance.team_clearance_projections')
      .selectAll()
      .where('division_settings_id', '=', settingsId)
      .execute();
  }

  countReviewSubmissions(divisionId: string) {
    return this.db
      .selectFrom('compliance.team_submissions as submissions')
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'submissions.team_id')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('teams.division_id', '=', divisionId)
      .where('teams.status', '=', 'active')
      .where('requirements.archived_at', 'is', null)
      .where('submissions.workflow_status', 'in', ['submitted', 'under_review'])
      .executeTakeFirstOrThrow()
      .then((row) => Number(row.count));
  }

  findReviewSubmission(organizationId: string, submissionId: string) {
    return this.db
      .selectFrom('compliance.team_submissions as submissions')
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'submissions.team_id')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'submissions.current_attempt_id',
        'submissions.id',
        'submissions.review_note',
        'submissions.reviewed_at',
        'submissions.submitted_at',
        'submissions.waiver_expires_at',
        'submissions.waiver_reason',
        'submissions.workflow_status',
        'requirements.id as requirement_id',
        'requirements.is_required',
        'requirements.response_type',
        'requirements.title as requirement_title',
        'divisions.id as division_id',
        'teams.id as team_id',
        'teams.name as team_name',
      ])
      .where('submissions.id', '=', submissionId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();
  }

  findComplianceNotificationContext(submissionId: string) {
    return this.db
      .selectFrom('compliance.team_submissions as submissions')
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'submissions.team_id')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'seasons.organization_id',
      )
      .select([
        'submissions.id as submission_id',
        'submissions.team_id',
        'submissions.requirement_id',
        'requirements.title as requirement_title',
        'divisions.id as division_id',
        'divisions.name as division_name',
        'teams.name as team_name',
        'seasons.organization_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('submissions.id', '=', submissionId)
      .executeTakeFirst();
  }

  findDivisionNotificationContext(divisionId: string) {
    return this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'seasons.organization_id',
      )
      .select([
        'divisions.id as division_id',
        'divisions.name as division_name',
        'seasons.organization_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('divisions.id', '=', divisionId)
      .executeTakeFirst();
  }

  findTeamManagerRecipients(teamId: string) {
    return this.db
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select('members.user_id')
      .where('assignments.team_id', '=', teamId)
      .where('members.status', '=', 'active')
      .execute();
  }

  findComplianceReviewers(organizationId: string) {
    return this.db
      .selectFrom('admin.organization_members')
      .select('user_id')
      .where('organization_id', '=', organizationId)
      .where('status', '=', 'active')
      .where('role', 'in', ['owner', 'admin'])
      .execute();
  }

  async listReviewQueue(
    divisionId: string,
    statuses: readonly ComplianceWorkflowStatus[] | undefined,
    search: string | undefined,
    pagination: NormalizedPagination,
  ) {
    let base = this.db
      .selectFrom('compliance.team_submissions as submissions')
      .innerJoin(
        'compliance.requirements as requirements',
        'requirements.id',
        'submissions.requirement_id',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'submissions.team_id')
      .where('teams.division_id', '=', divisionId)
      .where('teams.status', '=', 'active')
      .where('requirements.archived_at', 'is', null);
    if (statuses?.length) {
      base = base.where('submissions.workflow_status', 'in', statuses);
    }
    if (search) {
      base = base.where((eb) =>
        eb.or([
          eb('teams.name', 'ilike', `%${search}%`),
          eb('requirements.title', 'ilike', `%${search}%`),
        ]),
      );
    }
    const count = await base
      .select((eb) => eb.fn.countAll().as('count'))
      .executeTakeFirstOrThrow();
    const data = await base
      .select([
        'submissions.id as submission_id',
        'submissions.workflow_status',
        'submissions.submitted_at',
        'submissions.reviewed_at',
        'teams.id as team_id',
        'teams.name as team_name',
        'requirements.id as requirement_id',
        'requirements.title as requirement_title',
        'requirements.is_required',
      ])
      .orderBy('submissions.updated_at desc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();
    return { data, total: Number(count.count) };
  }

  writeAudit(
    access: OrganizationAccessContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    return this.db
      .insertInto('access.audit_events')
      .values({
        action,
        actor_member_id: access.membershipId,
        metadata: metadata as never,
        organization_id: access.organizationId,
        target_id: targetId,
        target_type: targetType,
      })
      .execute();
  }
}
