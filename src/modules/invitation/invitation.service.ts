import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AUTH_ROLES,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { AuthUser } from '../auth/auth.types';
import { TeamAssignmentPolicyService } from '../organization-member/team-assignment-policy.service';
import { NotificationWriter } from '../notification/notification.writer';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import type { UpdateInvitationDto } from './dto/update-invitation.dto';
import { INVITATION_MAILER, type InvitationMailer } from './invitation-mailer';
import { InvitationTokenService } from './invitation-token.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function roleLabel(role: string): string {
  return role
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

type InvitationTeamAssignment = {
  id: string;
  leagueSeasonId: string;
  leagueSeasonName: string;
  name: string;
  slug: string;
};

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  const visible = localPart.slice(0, 2);

  return `${visible}${'*'.repeat(Math.max(localPart.length - 2, 2))}@${domain}`;
}

@Injectable()
export class InvitationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(INVITATION_MAILER) private readonly mailer: InvitationMailer,
    private readonly tokenService: InvitationTokenService,
    private readonly teamAssignmentPolicy: TeamAssignmentPolicyService,
    @Optional() private readonly notificationWriter?: NotificationWriter,
  ) {}

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    input: CreateInvitationDto,
  ) {
    const email = this.tokenService.normalizeEmail(input.email);
    const teamIds = input.teamIds ?? [];
    const teams = await this.teamAssignmentPolicy.resolve(
      organizationId,
      input.role,
      teamIds,
    );
    const { token, tokenHash } = this.tokenService.createTokenPair();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const organization = await this.findOrganization(organizationId);
    const invitedUser = await this.findUserByEmail(email);

    const existing = await (this.db as any)
      .selectFrom('access.organization_invitations')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('email', '=', email)
      .where('status', '=', 'pending')
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'A pending invitation already exists for this email',
      );
    }

    const invitation = await (this.db as any)
      .transaction()
      .execute(async (trx: any) => {
        const created = await trx
          .insertInto('access.organization_invitations')
          .values({
            email,
            expires_at: expiresAt,
            invited_by_member_id: access.membershipId,
            organization_id: organizationId,
            role: input.role,
            token_hash: tokenHash,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await this.replaceInvitationAssignmentsInTransaction(
          trx,
          created.id,
          teams,
        );

        await this.notificationWriter?.create(
          {
            actionExpiresAt: expiresAt,
            context: {
              invitationId: created.id,
              organizationName: organization.name,
              organizationSlug: organization.slug,
              roleLabel: roleLabel(input.role),
            },
            dedupeKey: `invitation:${created.id}:received`,
            eventType: 'access.invitation_received',
            organizationId,
            recipients: invitedUser
              ? [{ userId: invitedUser.id }]
              : [{ email }],
            resourceId: created.id,
            resourceType: 'invitation',
            retainUntil: new Date(expiresAt.getTime() + NOTIFICATION_RETENTION_MS),
          },
          trx,
        );

        return created;
      });

    const acceptanceUrl = this.buildAcceptanceUrl(token);
    await this.mailer.sendInvitation({
      acceptanceUrl,
      email,
      organizationName: organization.name,
      role: input.role,
    });
    await this.writeAudit(
      access,
      'invitation.created',
      'invitation',
      invitation.id,
      {
        email,
        role: input.role,
        teamIds,
      },
    );

    return {
      ...this.serializeInvitation(invitation, this.toTeamAssignments(teams)),
      acceptanceUrl,
    };
  }

  async findAll(organizationId: string) {
    const invitations = await (this.db as any)
      .selectFrom('access.organization_invitations')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at desc')
      .execute();
    const assignments = await this.findInvitationAssignments(
      invitations.map((invitation: any) => invitation.id),
    );

    return invitations.map((invitation: any) =>
      this.serializeInvitation(
        invitation,
        assignments.get(invitation.id) ?? [],
      ),
    );
  }

  async resend(
    organizationId: string,
    invitationId: string,
    access: OrganizationAccessContext,
  ) {
    const invitation = await this.findInvitation(organizationId, invitationId);

    if (this.resolveInvitationStatus(invitation) !== 'pending') {
      throw new BadRequestException('Only pending invitations can be resent');
    }

    const { token, tokenHash } = this.tokenService.createTokenPair();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const organization = await this.findOrganization(organizationId);
    const updated = await (this.db as any)
      .updateTable('access.organization_invitations')
      .set({
        expires_at: expiresAt,
        token_hash: tokenHash,
        updated_at: new Date(),
      })
      .where('id', '=', invitationId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const invitedUser = await this.findUserByEmail(updated.email);

    const acceptanceUrl = this.buildAcceptanceUrl(token);
    await this.mailer.sendInvitation({
      acceptanceUrl,
      email: updated.email,
      organizationName: organization.name,
      role: updated.role,
    });
    await this.writeAudit(
      access,
      'invitation.resent',
      'invitation',
      invitationId,
      {
        email: updated.email,
        teamIds: await this.getInvitationTeamIds(invitationId),
      },
    );

    await this.notificationWriter?.create({
      actionExpiresAt: expiresAt,
      context: {
        invitationId,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        roleLabel: roleLabel(updated.role),
      },
      dedupeKey: `invitation:${invitationId}:resent:${expiresAt.toISOString()}`,
      eventType: 'access.invitation_resent',
      organizationId,
      recipients: invitedUser ? [{ userId: invitedUser.id }] : [{ email: updated.email }],
      resourceId: invitationId,
      resourceType: 'invitation',
      retainUntil: new Date(expiresAt.getTime() + NOTIFICATION_RETENTION_MS),
    });

    const assignments = await this.findInvitationAssignments([invitationId]);

    return {
      ...this.serializeInvitation(
        updated,
        assignments.get(invitationId) ?? [],
      ),
      acceptanceUrl,
    };
  }

  async update(
    organizationId: string,
    invitationId: string,
    access: OrganizationAccessContext,
    input: UpdateInvitationDto,
  ) {
    const invitation = await this.findInvitation(organizationId, invitationId);

    if (this.resolveInvitationStatus(invitation) !== 'pending') {
      throw new BadRequestException(
        'Only active pending invitations can be edited',
      );
    }

    const teams = await this.teamAssignmentPolicy.resolve(
      organizationId,
      input.role,
      input.teamIds,
    );
    const updated = await (this.db as any)
      .transaction()
      .execute(async (trx: any) => {
        const result = await trx
          .updateTable('access.organization_invitations')
          .set({
            role: input.role,
            updated_at: new Date(),
          })
          .where('id', '=', invitationId)
          .where('organization_id', '=', organizationId)
          .returningAll()
          .executeTakeFirstOrThrow();

        await this.replaceInvitationAssignmentsInTransaction(
          trx,
          invitationId,
          teams,
        );

        return result;
      });

    await this.writeAudit(
      access,
      'invitation.updated',
      'invitation',
      invitationId,
      {
        role: input.role,
        teamIds: input.teamIds,
      },
    );

    const invitedUser = await this.findUserByEmail(invitation.email);
    await this.notificationWriter?.create({
      actionExpiresAt: updated.expires_at,
      context: {
        invitationId,
        organizationName: (await this.findOrganization(organizationId)).name,
        roleLabel: roleLabel(updated.role),
      },
      dedupeKey: `invitation:${invitationId}:scope:${updated.updated_at.toISOString()}`,
      eventType: 'access.invitation_scope_changed',
      organizationId,
      recipients: invitedUser ? [{ userId: invitedUser.id }] : [{ email: invitation.email }],
      resourceId: invitationId,
      resourceType: 'invitation',
      retainUntil: new Date(updated.expires_at.getTime() + NOTIFICATION_RETENTION_MS),
    });

    return {
      ...this.serializeInvitation(updated, this.toTeamAssignments(teams)),
    };
  }

  async revoke(
    organizationId: string,
    invitationId: string,
    access: OrganizationAccessContext,
  ) {
    const invitation = await this.findInvitation(organizationId, invitationId);

    if (invitation.status !== 'pending') {
      return this.serializeInvitation(
        invitation,
        (await this.findInvitationAssignments([invitationId])).get(
          invitationId,
        ) ?? [],
      );
    }

    const updated = await (this.db as any)
      .updateTable('access.organization_invitations')
      .set({
        revoked_at: new Date(),
        status: 'revoked',
        updated_at: new Date(),
      })
      .where('id', '=', invitationId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(
      access,
      'invitation.revoked',
      'invitation',
      invitationId,
      {
        email: updated.email,
      },
    );

    await this.notificationWriter?.clearInvitationActions(invitationId);

    const invitedUser = await this.findUserByEmail(updated.email);
    await this.notificationWriter?.create({
      context: {
        invitationId,
        organizationName: (await this.findOrganization(organizationId)).name,
      },
      dedupeKey: `invitation:${invitationId}:revoked`,
      eventType: 'access.invitation_revoked',
      organizationId,
      recipients: invitedUser ? [{ userId: invitedUser.id }] : [{ email: updated.email }],
      resourceId: invitationId,
      resourceType: 'invitation',
    });

    const assignments = await this.findInvitationAssignments([invitationId]);

    return this.serializeInvitation(
      updated,
      assignments.get(invitationId) ?? [],
    );
  }

  async preview(token: string) {
    const invitation = await this.findInvitationByToken(token);
    const assignments = await this.findInvitationAssignments([invitation.id]);

    return {
      email: maskEmail(invitation.email),
      expires_at: invitation.expires_at,
      organization: {
        name: invitation.organization_name,
        slug: invitation.organization_slug,
      },
      role: invitation.role,
      status: this.resolveInvitationStatus(invitation),
      teamAssignments: assignments.get(invitation.id) ?? [],
    };
  }

  async previewById(invitationId: string, user: AuthUser) {
    const invitation = await this.findInvitationById(invitationId);
    this.assertInvitationEmailMatchesUser(invitation, user);
    const assignments = await this.findInvitationAssignments([invitation.id]);

    return {
      email: maskEmail(invitation.email),
      expires_at: invitation.expires_at,
      id: invitation.id,
      organization: {
        name: invitation.organization_name,
        slug: invitation.organization_slug,
      },
      role: invitation.role,
      status: this.resolveInvitationStatus(invitation),
      teamAssignments: assignments.get(invitation.id) ?? [],
    };
  }

  async accept(input: AcceptInvitationDto, user: AuthUser) {
    const invitation = await this.findInvitationByToken(input.token);
    return this.acceptResolvedInvitation(invitation, user);
  }

  async acceptById(invitationId: string, user: AuthUser) {
    const invitation = await this.findInvitationById(invitationId);
    return this.acceptResolvedInvitation(invitation, user);
  }

  private async acceptResolvedInvitation(invitation: any, user: AuthUser) {
    this.assertInvitationEmailMatchesUser(invitation, user);

    if (invitation.status === 'accepted') {
      if (invitation.accepted_user_id === user.id) {
        return this.acceptedResponse(invitation.accepted_by_member_id);
      }

      throw new ConflictException('This invitation has already been accepted');
    }

    if (this.resolveInvitationStatus(invitation) !== 'pending') {
      throw new BadRequestException('This invitation is no longer active');
    }

    return (this.db as any).transaction().execute(async (trx: any) => {
      const existingMembership = await trx
        .selectFrom('admin.organization_members')
        .selectAll()
        .where('organization_id', '=', invitation.organization_id)
        .where('user_id', '=', user.id)
        .executeTakeFirst();

      if (existingMembership?.status === 'active') {
        throw new ConflictException(
          'You are already an active member of this organization',
        );
      }

      const member = existingMembership
        ? await trx
            .updateTable('admin.organization_members')
            .set({
              role: invitation.role,
              status: 'active',
              updated_at: new Date(),
            })
            .where('id', '=', existingMembership.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .insertInto('admin.organization_members')
            .values({
              organization_id: invitation.organization_id,
              role: invitation.role,
              status: 'active',
              user_id: user.id,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

      const assignments = await this.findInvitationAssignments(
        [invitation.id],
        trx,
      );
      const intendedAssignments = assignments.get(invitation.id) ?? [];

      await trx
        .deleteFrom('access.team_manager_assignments')
        .where('organization_member_id', '=', member.id)
        .execute();
      await trx
        .deleteFrom('access.game_scorekeeper_assignments')
        .where('organization_member_id', '=', member.id)
        .execute();

      if (
        invitation.role === AUTH_ROLES.TEAM_MANAGER &&
        intendedAssignments.length
      ) {
        await trx
          .insertInto('access.team_manager_assignments')
          .values(
            intendedAssignments.map((assignment) => ({
              league_season_id: assignment.leagueSeasonId,
              organization_member_id: member.id,
              team_id: assignment.id,
            })),
          )
          .execute();
      }

      await trx
        .updateTable('access.organization_invitations')
        .set({
          accepted_at: new Date(),
          accepted_by_member_id: member.id,
          status: 'accepted',
          updated_at: new Date(),
        })
        .where('id', '=', invitation.id)
        .execute();

      await trx
        .insertInto('access.audit_events')
        .values({
          action: 'invitation.accepted',
          actor_member_id: member.id,
          metadata: {
            email: invitation.email,
            role: invitation.role,
            teamIds: intendedAssignments.map((assignment) => assignment.id),
          },
          organization_id: invitation.organization_id,
          target_id: invitation.id,
          target_type: 'invitation',
        })
        .execute();

      await this.notificationWriter?.clearInvitationActions(invitation.id, trx);

      const notificationRecipients = await trx
        .selectFrom('admin.organization_members as recipients')
        .select('recipients.user_id')
        .where('recipients.organization_id', '=', invitation.organization_id)
        .where('recipients.status', '=', 'active')
        .where((eb: any) =>
          eb.or([
            eb('recipients.role', '=', AUTH_ROLES.OWNER),
            eb('recipients.id', '=', invitation.invited_by_member_id),
          ]),
        )
        .execute();

      await this.notificationWriter?.create(
        {
          actorUserId: user.id,
          context: {
            memberName: user.name,
            organizationName: invitation.organization_name,
            organizationSlug: invitation.organization_slug,
          },
          dedupeKey: `invitation:${invitation.id}:accepted`,
          eventType: 'access.invitation_accepted',
          organizationId: invitation.organization_id,
          recipients: notificationRecipients
            .filter((recipient: any) => recipient.user_id)
            .map((recipient: any) => ({ userId: recipient.user_id })),
          resourceId: invitation.id,
          resourceType: 'invitation',
        },
        trx,
      );

      return this.acceptedResponse(member.id);
    });
  }

  private assertInvitationEmailMatchesUser(invitation: any, user: AuthUser) {
    const normalizedUserEmail = this.tokenService.normalizeEmail(user.email);

    if (normalizedUserEmail !== invitation.email) {
      throw new ForbiddenException(
        'Sign in with the invited email address to accept this invitation',
      );
    }
  }

  private acceptedResponse(membershipId?: string | null) {
    return {
      membershipId,
      success: true,
    };
  }

  private buildAcceptanceUrl(token: string): string {
    const url = new URL('/invitations/accept', APP_BASE_URL);
    url.searchParams.set('token', token);
    return url.toString();
  }

  private async findOrganization(organizationId: string) {
    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['name', 'slug'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  private async findUserByEmail(email: string) {
    return (this.db as any)
      .selectFrom('auth.users')
      .select(['id'])
      .where('email', '=', email)
      .executeTakeFirst();
  }

  private async findInvitation(organizationId: string, invitationId: string) {
    const invitation = await (this.db as any)
      .selectFrom('access.organization_invitations')
      .selectAll()
      .where('id', '=', invitationId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  private async findInvitationByToken(token: string) {
    const tokenHash = this.tokenService.hashToken(token);
    const invitation = await (this.db as any)
      .selectFrom('access.organization_invitations as invitations')
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'invitations.organization_id',
      )
      .leftJoin(
        'admin.organization_members as members',
        'members.id',
        'invitations.accepted_by_member_id',
      )
      .select([
        'invitations.accepted_at',
        'invitations.accepted_by_member_id',
        'invitations.created_at',
        'invitations.email',
        'invitations.expires_at',
        'invitations.id',
        'invitations.invited_by_member_id',
        'invitations.organization_id',
        'invitations.revoked_at',
        'invitations.role',
        'invitations.status',
        'members.user_id as accepted_user_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('invitations.token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  private async findInvitationById(invitationId: string) {
    const invitation = await (this.db as any)
      .selectFrom('access.organization_invitations as invitations')
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'invitations.organization_id',
      )
      .leftJoin(
        'admin.organization_members as members',
        'members.id',
        'invitations.accepted_by_member_id',
      )
      .select([
        'invitations.accepted_at',
        'invitations.accepted_by_member_id',
        'invitations.created_at',
        'invitations.email',
        'invitations.expires_at',
        'invitations.id',
        'invitations.invited_by_member_id',
        'invitations.organization_id',
        'invitations.revoked_at',
        'invitations.role',
        'invitations.status',
        'members.user_id as accepted_user_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('invitations.id', '=', invitationId)
      .executeTakeFirst();

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    return invitation;
  }

  private resolveInvitationStatus(invitation: {
    expires_at: Date;
    revoked_at?: Date | null;
    status: string;
  }): string {
    if (invitation.status !== 'pending') {
      return invitation.status;
    }

    if (invitation.revoked_at) {
      return 'revoked';
    }

    if (new Date(invitation.expires_at).getTime() <= Date.now()) {
      return 'expired';
    }

    return 'pending';
  }

  private serializeInvitation(
    invitation: any,
    teamAssignments: InvitationTeamAssignment[],
  ) {
    const { token_hash: _tokenHash, ...safeInvitation } = invitation;
    return {
      ...safeInvitation,
      status: this.resolveInvitationStatus(invitation),
      teamAssignments,
    };
  }

  private async findInvitationAssignments(
    invitationIds: string[],
    db: any = this.db,
  ): Promise<Map<string, InvitationTeamAssignment[]>> {
    const byInvitation = new Map<string, InvitationTeamAssignment[]>();

    if (!invitationIds.length) {
      return byInvitation;
    }

    const rows = await db
      .selectFrom(
        'access.invitation_team_assignments as assignments',
      )
      .innerJoin('admin.teams as teams', 'teams.id', 'assignments.team_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'assignments.league_season_id',
      )
      .select([
        'assignments.invitation_id',
        'assignments.league_season_id',
        'league_seasons.name as league_season_name',
        'teams.id',
        'teams.name',
        'teams.slug',
      ])
      .where('assignments.invitation_id', 'in', invitationIds)
      .execute();

    for (const row of rows) {
      const values = byInvitation.get(row.invitation_id) ?? [];
      values.push({
        id: row.id,
        leagueSeasonId: row.league_season_id,
        leagueSeasonName: row.league_season_name,
        name: row.name,
        slug: row.slug,
      });
      byInvitation.set(row.invitation_id, values);
    }

    return byInvitation;
  }

  private async getInvitationTeamIds(invitationId: string) {
    const assignments = await this.findInvitationAssignments([invitationId]);
    return (assignments.get(invitationId) ?? []).map((assignment) => assignment.id);
  }

  private toTeamAssignments(
    teams: Array<{
      id: string;
      league_season_id: string;
      league_season_name: string;
      name: string;
      slug: string;
    }>,
  ): InvitationTeamAssignment[] {
    return teams.map((team) => ({
      id: team.id,
      leagueSeasonId: team.league_season_id,
      leagueSeasonName: team.league_season_name,
      name: team.name,
      slug: team.slug,
    }));
  }

  private async replaceInvitationAssignmentsInTransaction(
    trx: any,
    invitationId: string,
    teams: Array<{
      id: string;
      league_season_id: string;
    }>,
  ) {
    await trx
      .deleteFrom('access.invitation_team_assignments')
      .where('invitation_id', '=', invitationId)
      .execute();

    if (teams.length) {
      await trx
        .insertInto('access.invitation_team_assignments')
        .values(
          teams.map((team) => ({
            invitation_id: invitationId,
            league_season_id: team.league_season_id,
            team_id: team.id,
          })),
        )
        .execute();
    }
  }

  private async writeAudit(
    access: OrganizationAccessContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await (this.db as any)
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
