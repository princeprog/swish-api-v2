import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { ReturnRosterDto } from './dto/return-roster.dto';
import type { StartAmendmentDto } from './dto/start-amendment.dto';
import type { UpdateRosterSettingsDto } from './dto/update-roster-settings.dto';
import {
  canExposeRosterPlayers,
  ensureRosterCanBeEdited,
  type RosterWorkflowStatus,
  validateRosterSubmissionCount,
} from './roster-policy';
import { NotificationWriter } from '../notification/notification.writer';
import type { NotificationEventType } from '../notification/notification.events';

type TeamRosterContext = {
  division_id: string;
  division_name: string;
  latest_approved_version_id: string | null;
  published_version_id: string | null;
  released_at: Date | null;
  roster_id: string;
  team_id: string;
  team_name: string;
  workflow_status: RosterWorkflowStatus;
};

export function resolveRosterDeadlineEvent(
  previous: Date | string | null | undefined,
  next: Date | string | null | undefined,
): Extract<NotificationEventType, `roster.deadline_${string}`> | null {
  const previousAt = previous ? new Date(previous).getTime() : null;
  const nextAt = next ? new Date(next).getTime() : null;

  if (nextAt === null || Number.isNaN(nextAt)) {
    return null;
  }

  if (previousAt === null || Number.isNaN(previousAt)) {
    return 'roster.deadline_set';
  }

  return previousAt === nextAt ? null : 'roster.deadline_changed';
}

function formatDeadlineLabel(value: Date | string): string {
  return new Intl.DateTimeFormat('en-PH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Manila',
  }).format(new Date(value));
}

@Injectable()
export class RosterService implements OnModuleInit, OnModuleDestroy {
  private deadlineTimer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Optional() private readonly notificationWriter?: NotificationWriter,
  ) {}

  onModuleInit() {
    void this.releaseDueDeadlines();
    this.deadlineTimer = setInterval(() => {
      void this.releaseDueDeadlines();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.deadlineTimer) {
      clearInterval(this.deadlineTimer);
    }
  }

  async findDivisionRosters(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    await this.assertCanReadDivisionRosters(organizationId, divisionId, access);
    const settings = await this.ensureDivisionSettings(divisionId);
    const isReviewer = this.isReviewer(access);
    const released = settings.released_at !== null;

    const rows = await (this.db as any)
      .selectFrom('admin.teams as teams')
      .leftJoin('admin.team_rosters as rosters', 'rosters.team_id', 'teams.id')
      .leftJoin('admin.roster_version_players as published_players', (join) =>
        join.onRef(
          'published_players.roster_version_id',
          '=',
          'rosters.published_version_id',
        ),
      )
      .select([
        'teams.id as team_id',
        'teams.name as team_name',
        'teams.slug as team_slug',
        'teams.status as team_status',
        'rosters.workflow_status',
        'rosters.submitted_at',
        'rosters.reviewed_at',
        'rosters.published_at',
        'rosters.published_version_id',
      ])
      .select((eb) => eb.fn.count('published_players.id').as('published_count'))
      .where('teams.division_id', '=', divisionId)
      .where('teams.status', '=', 'active')
      .groupBy([
        'teams.id',
        'rosters.workflow_status',
        'rosters.submitted_at',
        'rosters.reviewed_at',
        'rosters.published_at',
        'rosters.published_version_id',
      ])
      .orderBy('teams.name asc')
      .execute();

    return {
      settings: this.mapSettings(settings),
      release: {
        isReleased: released,
        releasedAt: settings.released_at,
        releaseReason: settings.release_reason,
      },
      teams: rows.map((row) => ({
        id: row.team_id,
        name: row.team_name,
        slug: row.team_slug,
        status: row.workflow_status ?? 'draft',
        submittedAt: row.submitted_at,
        reviewedAt: row.reviewed_at,
        publishedAt: row.published_at,
        isPublished: row.published_version_id !== null,
        publishedPlayerCount:
          isReviewer || released ? Number(row.published_count) : null,
      })),
    };
  }

  async findTeamRoster(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
  ) {
    const context = await this.ensureTeamRosterContext(organizationId, teamId);
    const isReviewer = this.isReviewer(access);
    const isAssignedTeam = await this.isAssignedTeam(access.membershipId, teamId);

    if (!isReviewer && !isAssignedTeam) {
      await this.assertCanReadDivisionRosters(
        organizationId,
        context.division_id,
        access,
      );
    }

    const canReadPlayers = canExposeRosterPlayers({
      hasPublishedVersion: context.published_version_id !== null,
      isAssignedTeam,
      isReviewer,
      isReleased: context.released_at !== null,
    });

    if (!canReadPlayers) {
      return {
        visibility: 'hidden',
        team: {
          id: context.team_id,
          name: context.team_name,
          divisionId: context.division_id,
          divisionName: context.division_name,
        },
        message:
          'Official rosters for other teams will be visible after roster release.',
      };
    }

    const source =
      isReviewer || isAssignedTeam
        ? await this.findWorkingPlayers(teamId)
        : await this.findPublishedPlayers(context.published_version_id);

    return {
      visibility: isReviewer || isAssignedTeam ? 'working' : 'published',
      team: {
        id: context.team_id,
        name: context.team_name,
        divisionId: context.division_id,
        divisionName: context.division_name,
      },
      roster: {
        id: context.roster_id,
        status: context.workflow_status,
        isReleased: context.released_at !== null,
        latestApprovedVersionId: context.latest_approved_version_id,
        publishedVersionId: context.published_version_id,
      },
      players: source,
    };
  }

  async findHistory(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
  ) {
    const context = await this.ensureTeamRosterContext(organizationId, teamId);
    const isAssignedTeam = await this.isAssignedTeam(access.membershipId, teamId);

    if (!this.isReviewer(access) && !isAssignedTeam) {
      throw new ForbiddenException('You cannot view this roster history.');
    }

    const versions = await (this.db as any)
      .selectFrom('admin.roster_versions')
      .selectAll()
      .where('team_roster_id', '=', context.roster_id)
      .orderBy('version_number desc')
      .execute();

    return { versions };
  }

  async submitTeamRoster(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
  ) {
    await this.assertCanSubmitAssignedTeam(access, teamId);
    const context = await this.ensureTeamRosterContext(organizationId, teamId);
    ensureRosterCanBeEdited(context.workflow_status);
    const settings = await this.ensureDivisionSettings(context.division_id);
    const activePlayerCount = await this.countActivePlayers(teamId);

    validateRosterSubmissionCount({
      activePlayerCount,
      maxActivePlayers: settings.max_active_players,
      minActivePlayers: settings.min_active_players,
    });

    const roster = await this.db
      .updateTable('admin.team_rosters')
      .set({
        workflow_status: 'submitted',
        submitted_at: new Date(),
        submitted_by_member_id: access.membershipId,
        review_note: null,
        updated_at: new Date(),
      })
      .where('id', '=', context.roster_id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(access, 'roster.submitted', 'team_roster', roster.id, {
      teamId,
      activePlayerCount,
    });

    await this.notifyRosterReviewers(
      organizationId,
      teamId,
      access,
      'roster.submitted',
      roster.id,
      { activePlayerCount },
    );

    return roster;
  }

  async startAmendment(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
    dto: StartAmendmentDto,
  ) {
    await this.assertCanSubmitAssignedTeam(access, teamId);
    const context = await this.ensureTeamRosterContext(organizationId, teamId);

    if (!context.published_version_id) {
      throw new BadRequestException(
        'This roster must be published before starting an amendment.',
      );
    }

    const roster = await this.db
      .updateTable('admin.team_rosters')
      .set({
        workflow_status: 'draft',
        amendment_reason: dto.reason,
        submitted_at: null,
        submitted_by_member_id: null,
        reviewed_at: null,
        reviewed_by_member_id: null,
        review_note: null,
        updated_at: new Date(),
      })
      .where('id', '=', context.roster_id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(
      access,
      'roster.amendment_started',
      'team_roster',
      roster.id,
      { teamId, reason: dto.reason },
    );

    await this.notifyRosterReviewers(
      organizationId,
      teamId,
      access,
      'roster.amendment_started',
      roster.id,
      { reason: dto.reason },
    );

    return roster;
  }

  async approveTeamRoster(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanReview(access);
    const context = await this.ensureTeamRosterContext(organizationId, teamId);

    if (context.workflow_status !== 'submitted') {
      throw new BadRequestException(
        'Only submitted rosters can be approved for official release.',
      );
    }

    const approved = await (this.db as any).transaction().execute(async (trx) => {
      const version = await this.createRosterVersion(trx, context, access);
      const settings = await this.ensureDivisionSettings(
        context.division_id,
        trx,
      );
      const shouldPublishTeam = settings.released_at !== null;

      const roster = await trx
        .updateTable('admin.team_rosters')
        .set({
          workflow_status: 'approved',
          reviewed_at: new Date(),
          reviewed_by_member_id: access.membershipId,
          review_note: null,
          latest_approved_version_id: version.id,
          published_version_id: shouldPublishTeam ? version.id : undefined,
          published_at: shouldPublishTeam ? new Date() : undefined,
          updated_at: new Date(),
        })
        .where('id', '=', context.roster_id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (!shouldPublishTeam) {
        await this.releaseDivisionIfAllApproved(
          trx,
          context.division_id,
          access,
          'all_approved',
        );
      }

      return roster;
    });

    await this.writeAudit(
      access,
      'roster.approved',
      'team_roster',
      approved.id,
      { teamId },
    );

    await this.notifyTeamManagers(
      organizationId,
      teamId,
      access,
      'roster.approved',
      approved.id,
    );

    return approved;
  }

  async returnTeamRoster(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
    dto: ReturnRosterDto,
  ) {
    this.assertCanReview(access);
    const context = await this.ensureTeamRosterContext(organizationId, teamId);

    if (context.workflow_status !== 'submitted') {
      throw new BadRequestException('Only submitted rosters can be returned.');
    }

    const roster = await this.db
      .updateTable('admin.team_rosters')
      .set({
        workflow_status: 'returned',
        reviewed_at: new Date(),
        reviewed_by_member_id: access.membershipId,
        review_note: dto.reason,
        updated_at: new Date(),
      })
      .where('id', '=', context.roster_id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(access, 'roster.returned', 'team_roster', roster.id, {
      teamId,
      reason: dto.reason,
    });

    await this.notifyTeamManagers(
      organizationId,
      teamId,
      access,
      'roster.returned',
      roster.id,
      { reviewNote: dto.reason },
    );

    return roster;
  }

  async publishDivisionRosters(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    this.assertCanPublish(access);
    await this.assertDivisionBelongsToOrganization(organizationId, divisionId);

    await (this.db as any).transaction().execute(async (trx) => {
      await this.releaseApprovedDivisionRosters(
        trx,
        divisionId,
        access,
        'manual',
      );
    });

    if (this.notificationWriter) {
      const teams = await (this.db as any)
        .selectFrom('admin.teams as teams')
        .leftJoin('admin.team_rosters as rosters', 'rosters.team_id', 'teams.id')
        .select(['teams.id', 'rosters.id as roster_id'])
        .where('teams.division_id', '=', divisionId)
        .where('teams.status', '=', 'active')
        .execute();

      for (const team of teams) {
        await this.notifyTeamManagers(
          organizationId,
          team.roster_id ?? team.id,
          access,
          'roster.published',
          team.id,
        );
      }
    }

    return this.findDivisionRosters(organizationId, divisionId, access);
  }

  async updateSettings(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
    dto: UpdateRosterSettingsDto,
  ) {
    this.assertCanManageSettings(access);
    const settings = await this.ensureDivisionSettings(divisionId);
    await this.assertDivisionBelongsToOrganization(organizationId, divisionId);

    if (settings.released_at) {
      throw new BadRequestException(
        'Roster release settings cannot be changed after release.',
      );
    }

    if (
      dto.minActivePlayers !== undefined &&
      dto.maxActivePlayers !== undefined &&
      dto.minActivePlayers !== null &&
      dto.maxActivePlayers !== null &&
      dto.minActivePlayers > dto.maxActivePlayers
    ) {
      throw new BadRequestException(
        'Minimum active players cannot be greater than the maximum.',
      );
    }

    const updated = await this.db
      .updateTable('admin.division_roster_settings')
      .set({
        min_active_players: dto.minActivePlayers,
        max_active_players: dto.maxActivePlayers,
        submission_deadline_at: dto.submissionDeadlineAt
          ? new Date(dto.submissionDeadlineAt)
          : dto.submissionDeadlineAt,
        updated_at: new Date(),
      })
      .where('division_id', '=', divisionId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(
      access,
      'roster_settings.updated',
      'division',
      divisionId,
      this.mapSettings(updated),
    );

    const deadlineEvent = resolveRosterDeadlineEvent(
      settings.submission_deadline_at,
      updated.submission_deadline_at,
    );

    if (deadlineEvent && this.notificationWriter && updated.submission_deadline_at) {
      const teams = await (this.db as any)
        .selectFrom('admin.teams')
        .select(['id'])
        .where('division_id', '=', divisionId)
        .where('status', '=', 'active')
        .execute();
      const deadlineLabel = formatDeadlineLabel(updated.submission_deadline_at);

      for (const team of teams) {
        await this.notifyTeamManagers(
          organizationId,
          team.id,
          access,
          deadlineEvent,
          `division:${divisionId}`,
          {
            deadlineLabel,
            dedupeKey: `roster:deadline:${divisionId}:${updated.updated_at?.toISOString?.() ?? new Date().toISOString()}:${team.id}`,
            resourceType: 'division',
            rosterLabel: 'Your team roster',
          },
        );
      }
    }

    return this.mapSettings(updated);
  }

  async assertRosterEditable(teamId: string): Promise<void> {
    const roster = await this.ensureTeamRoster(teamId);
    ensureRosterCanBeEdited(roster.workflow_status as RosterWorkflowStatus);
  }

  async releaseDueDeadlines() {
    const divisions = await (this.db as any)
      .selectFrom('admin.division_roster_settings')
      .select(['division_id'])
      .where('released_at', 'is', null)
      .where('submission_deadline_at', '<=', new Date())
      .execute();

    for (const division of divisions) {
      await (this.db as any).transaction().execute(async (trx) => {
        await this.releaseApprovedDivisionRosters(
          trx,
          division.division_id,
          null,
          'deadline',
        );
      });
    }
  }

  private async createRosterVersion(
    trx: any,
    context: TeamRosterContext,
    access: OrganizationAccessContext,
  ) {
    const latest = await trx
      .selectFrom('admin.roster_versions')
      .select((eb) => eb.fn.max('version_number').as('version_number'))
      .where('team_roster_id', '=', context.roster_id)
      .executeTakeFirst();

    const version = await trx
      .insertInto('admin.roster_versions')
      .values({
        team_roster_id: context.roster_id,
        version_number: Number(latest?.version_number ?? 0) + 1,
        approved_by_member_id: access.membershipId,
        amendment_reason: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const players = await trx
      .selectFrom('admin.players')
      .select(['id', 'name', 'jersey_number', 'position'])
      .where('team_id', '=', context.team_id)
      .where('status', '=', 'active')
      .orderBy('jersey_number asc')
      .orderBy('name asc')
      .orderBy('id asc')
      .execute();

    if (players.length) {
      await trx
        .insertInto('admin.roster_version_players')
        .values(
          players.map((player, index) => ({
            roster_version_id: version.id,
            source_player_id: player.id,
            name: player.name,
            jersey_number: player.jersey_number,
            position: player.position,
            sort_order: index + 1,
          })),
        )
        .execute();
    }

    return version;
  }

  private async releaseDivisionIfAllApproved(
    trx: any,
    divisionId: string,
    access: OrganizationAccessContext,
    reason: string,
  ) {
    const blocker = await trx
      .selectFrom('admin.teams as teams')
      .leftJoin('admin.team_rosters as rosters', 'rosters.team_id', 'teams.id')
      .select(['teams.id'])
      .where('teams.division_id', '=', divisionId)
      .where('teams.status', '=', 'active')
      .where((eb) =>
        eb.or([
          eb('rosters.workflow_status', 'is', null),
          eb('rosters.workflow_status', '!=', 'approved'),
        ]),
      )
      .executeTakeFirst();

    if (!blocker) {
      await this.releaseApprovedDivisionRosters(trx, divisionId, access, reason);
    }
  }

  private async releaseApprovedDivisionRosters(
    trx: any,
    divisionId: string,
    access: OrganizationAccessContext | null,
    reason: string,
  ) {
    const settings = await this.ensureDivisionSettings(divisionId, trx);
    const releasedAt = settings.released_at ?? new Date();

    await trx
      .updateTable('admin.division_roster_settings')
      .set({
        released_at: releasedAt,
        release_reason: settings.release_reason ?? reason,
        released_by_member_id:
          settings.released_by_member_id ?? access?.membershipId ?? null,
        updated_at: new Date(),
      })
      .where('division_id', '=', divisionId)
      .where('released_at', 'is', null)
      .execute();

    const approvedRosters = await trx
      .selectFrom('admin.team_rosters as rosters')
      .innerJoin('admin.teams as teams', 'teams.id', 'rosters.team_id')
      .select(['rosters.id', 'rosters.latest_approved_version_id'])
      .where('teams.division_id', '=', divisionId)
      .where('teams.status', '=', 'active')
      .where('rosters.workflow_status', '=', 'approved')
      .where('rosters.latest_approved_version_id', 'is not', null)
      .execute();

    for (const roster of approvedRosters) {
      await trx
        .updateTable('admin.team_rosters')
        .set({
          published_version_id: roster.latest_approved_version_id,
          published_at: releasedAt,
          updated_at: new Date(),
        })
        .where('id', '=', roster.id)
        .where((eb) =>
          eb.or([
            eb('published_version_id', 'is', null),
            eb(
              'published_version_id',
              '!=',
              roster.latest_approved_version_id,
            ),
          ]),
        )
        .execute();
    }

    if (access) {
      await this.writeAuditWithDb(
        trx,
        access,
        'rosters.released',
        'division',
        divisionId,
        { reason },
      );
    }
  }

  private async ensureTeamRosterContext(
    organizationId: string,
    teamId: string,
  ): Promise<TeamRosterContext> {
    const team = await (this.db as any)
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'teams.id as team_id',
        'teams.name as team_name',
        'divisions.id as division_id',
        'divisions.name as division_name',
      ])
      .where('teams.id', '=', teamId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    await this.ensureDivisionSettings(team.division_id);
    const roster = await this.ensureTeamRoster(teamId);

    const settings = await this.ensureDivisionSettings(team.division_id);

    return {
      ...team,
      latest_approved_version_id: roster.latest_approved_version_id,
      published_version_id: roster.published_version_id,
      released_at: settings.released_at,
      roster_id: roster.id,
      workflow_status: roster.workflow_status as RosterWorkflowStatus,
    };
  }

  private async ensureTeamRoster(teamId: string, db: any = this.db) {
    await db
      .insertInto('admin.team_rosters')
      .values({ team_id: teamId })
      .onConflict((oc) => oc.column('team_id').doNothing())
      .execute();

    return db
      .selectFrom('admin.team_rosters')
      .selectAll()
      .where('team_id', '=', teamId)
      .executeTakeFirstOrThrow();
  }

  private async ensureDivisionSettings(divisionId: string, db: any = this.db) {
    await db
      .insertInto('admin.division_roster_settings')
      .values({ division_id: divisionId })
      .onConflict((oc) => oc.column('division_id').doNothing())
      .execute();

    return db
      .selectFrom('admin.division_roster_settings')
      .selectAll()
      .where('division_id', '=', divisionId)
      .executeTakeFirstOrThrow();
  }

  private async findWorkingPlayers(teamId: string) {
    return this.db
      .selectFrom('admin.players')
      .select([
        'created_at',
        'id',
        'name',
        'jersey_number',
        'position',
        'status',
        'team_id',
        'updated_at',
      ])
      .where('team_id', '=', teamId)
      .orderBy('jersey_number asc')
      .orderBy('name asc')
      .execute();
  }

  private async findPublishedPlayers(versionId: string | null) {
    if (!versionId) {
      return [];
    }

    const players = await this.db
      .selectFrom('admin.roster_version_players')
      .select([
        'created_at',
        'id',
        'name',
        'jersey_number',
        'position',
      ])
      .where('roster_version_id', '=', versionId)
      .orderBy('sort_order asc')
      .execute();

    return players.map((player) => ({
      ...player,
      status: 'active',
      team_id: null,
      updated_at: player.created_at,
    }));
  }

  private async countActivePlayers(teamId: string) {
    const row = await this.db
      .selectFrom('admin.players')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('team_id', '=', teamId)
      .where('status', '=', 'active')
      .executeTakeFirstOrThrow();

    return Number(row.count);
  }

  private async assertCanReadDivisionRosters(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    await this.assertDivisionBelongsToOrganization(organizationId, divisionId);

    if (this.isReviewer(access)) {
      return;
    }

    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.ROSTERS_READ_ASSIGNED_DIVISION,
      )
    ) {
      throw new ForbiddenException('You cannot view division rosters.');
    }

    const assignment = await (this.db as any)
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin('admin.teams as teams', 'teams.id', 'assignments.team_id')
      .select(['assignments.id'])
      .where('assignments.organization_member_id', '=', access.membershipId)
      .where('teams.division_id', '=', divisionId)
      .executeTakeFirst();

    if (!assignment) {
      throw new ForbiddenException('You cannot view this division roster.');
    }
  }

  private async assertDivisionBelongsToOrganization(
    organizationId: string,
    divisionId: string,
  ) {
    const division = await this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select(['divisions.id'])
      .where('divisions.id', '=', divisionId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!division) {
      throw new NotFoundException('Division not found');
    }
  }

  private async assertCanSubmitAssignedTeam(
    access: OrganizationAccessContext,
    teamId: string,
  ) {
    if (this.isReviewer(access)) {
      return;
    }

    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.ROSTERS_SUBMIT_ASSIGNED_TEAM,
      )
    ) {
      throw new ForbiddenException('You cannot submit this roster.');
    }

    if (!(await this.isAssignedTeam(access.membershipId, teamId))) {
      throw new ForbiddenException('You cannot submit this team roster.');
    }
  }

  private async isAssignedTeam(memberId: string, teamId: string) {
    const assignment = await (this.db as any)
      .selectFrom('access.team_manager_assignments')
      .select(['id'])
      .where('organization_member_id', '=', memberId)
      .where('team_id', '=', teamId)
      .executeTakeFirst();

    return assignment !== undefined;
  }

  private isReviewer(access: OrganizationAccessContext) {
    return access.permissions.includes(ORGANIZATION_PERMISSIONS.ROSTERS_REVIEW);
  }

  private assertCanReview(access: OrganizationAccessContext) {
    if (!this.isReviewer(access)) {
      throw new ForbiddenException('You cannot review rosters.');
    }
  }

  private assertCanPublish(access: OrganizationAccessContext) {
    if (!access.permissions.includes(ORGANIZATION_PERMISSIONS.ROSTERS_PUBLISH)) {
      throw new ForbiddenException('You cannot publish rosters.');
    }
  }

  private assertCanManageSettings(access: OrganizationAccessContext) {
    if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.ROSTER_SETTINGS_MANAGE)
    ) {
      throw new ForbiddenException('You cannot update roster settings.');
    }
  }

  private mapSettings(settings: any) {
    return {
      id: settings.id,
      divisionId: settings.division_id,
      minActivePlayers: settings.min_active_players,
      maxActivePlayers: settings.max_active_players,
      submissionDeadlineAt: settings.submission_deadline_at,
      releasedAt: settings.released_at,
      releaseReason: settings.release_reason,
    };
  }

  private async findRosterNotificationContext(
    organizationId: string,
    teamId: string,
  ) {
    const context = await (this.db as any)
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
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
      .leftJoin('admin.team_rosters as rosters', 'rosters.team_id', 'teams.id')
      .select([
        'teams.name as team_name',
        'divisions.name as division_name',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
        'rosters.id as roster_id',
      ])
      .where('teams.id', '=', teamId)
      .where('organizations.id', '=', organizationId)
      .executeTakeFirst();

    if (!context) {
      throw new NotFoundException('Team not found');
    }

    return context;
  }

  private async findTeamManagerRecipients(teamId: string) {
    const rows = await (this.db as any)
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.team_id', '=', teamId)
      .where('members.status', '=', 'active')
      .execute();

    return rows.map((row: { user_id: string }) => ({ userId: row.user_id }));
  }

  private async findReviewerRecipients(organizationId: string) {
    const rows = await (this.db as any)
      .selectFrom('admin.organization_members')
      .select(['user_id'])
      .where('organization_id', '=', organizationId)
      .where('status', '=', 'active')
      .where('role', 'in', ['owner', 'admin'])
      .execute();

    return rows.map((row: { user_id: string }) => ({ userId: row.user_id }));
  }

  private async notifyTeamManagers(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
    eventType: Extract<NotificationEventType, `roster.${string}`>,
    resourceId: string,
    extra: {
      deadlineLabel?: string;
      dedupeKey?: string;
      resourceType?: string;
      reviewNote?: string;
      rosterLabel?: string;
    } = {},
  ) {
    if (!this.notificationWriter) {
      return;
    }

    const [context, recipients] = await Promise.all([
      this.findRosterNotificationContext(organizationId, teamId),
      this.findTeamManagerRecipients(teamId),
    ]);

    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        organizationName: context.organization_name,
        organizationSlug: context.organization_slug,
        deadlineLabel: extra.deadlineLabel,
        reviewNote: extra.reviewNote,
        rosterLabel: extra.rosterLabel ?? `${context.team_name} roster`,
      },
      dedupeKey:
        extra.dedupeKey ??
        `roster:${resourceId}:${eventType}:${new Date().toISOString()}`,
      eventType,
      organizationId,
      recipients,
      resourceId,
      resourceType: extra.resourceType ?? 'team_roster',
    });
  }

  private async notifyRosterReviewers(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
    eventType: Extract<NotificationEventType, `roster.${string}`>,
    resourceId: string,
    metadata: { activePlayerCount?: number; reason?: string } = {},
  ) {
    if (!this.notificationWriter) {
      return;
    }

    const [context, recipients] = await Promise.all([
      this.findRosterNotificationContext(organizationId, teamId),
      this.findReviewerRecipients(organizationId),
    ]);

    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        organizationName: context.organization_name,
        organizationSlug: context.organization_slug,
        reason: metadata.reason,
        rosterLabel: `${context.team_name} roster`,
      },
      dedupeKey: `roster:${resourceId}:${eventType}:${new Date().toISOString()}`,
      eventType,
      metadata,
      organizationId,
      recipients,
      resourceId,
      resourceType: 'team_roster',
    });
  }

  private async writeAudit(
    access: OrganizationAccessContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.writeAuditWithDb(this.db, access, action, targetType, targetId, metadata);
  }

  private async writeAuditWithDb(
    db: any,
    access: OrganizationAccessContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await db
      .insertInto('access.audit_events')
      .values({
        action,
        actor_member_id: access.membershipId,
        metadata,
        organization_id: access.organizationId,
        target_id: targetId,
        target_type: targetType,
      })
      .execute();
  }
}
