import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_ROLES,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { AuthUser } from '../auth/auth.types';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto';
import type { CreateInvitationDto } from './dto/create-invitation.dto';
import { INVITATION_MAILER, type InvitationMailer } from './invitation-mailer';
import { InvitationTokenService } from './invitation-token.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const APP_BASE_URL = process.env.APP_BASE_URL ?? 'http://localhost:3000';

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
  ) {}

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    input: CreateInvitationDto,
  ) {
    const email = this.tokenService.normalizeEmail(input.email);
    const { token, tokenHash } = this.tokenService.createTokenPair();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const organization = await this.findOrganization(organizationId);

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
      },
    );

    return { ...this.serializeInvitation(invitation), acceptanceUrl };
  }

  findAll(organizationId: string) {
    return (this.db as any)
      .selectFrom('access.organization_invitations')
      .select([
        'accepted_at',
        'created_at',
        'email',
        'expires_at',
        'id',
        'revoked_at',
        'role',
        'status',
        'updated_at',
      ])
      .where('organization_id', '=', organizationId)
      .orderBy('created_at desc')
      .execute();
  }

  async resend(
    organizationId: string,
    invitationId: string,
    access: OrganizationAccessContext,
  ) {
    const invitation = await this.findInvitation(organizationId, invitationId);

    if (invitation.status !== 'pending') {
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
      },
    );

    return { ...this.serializeInvitation(updated), acceptanceUrl };
  }

  async revoke(
    organizationId: string,
    invitationId: string,
    access: OrganizationAccessContext,
  ) {
    const invitation = await this.findInvitation(organizationId, invitationId);

    if (invitation.status !== 'pending') {
      return this.serializeInvitation(invitation);
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

    return this.serializeInvitation(updated);
  }

  async preview(token: string) {
    const invitation = await this.findInvitationByToken(token);

    return {
      email: maskEmail(invitation.email),
      expires_at: invitation.expires_at,
      organization: {
        name: invitation.organization_name,
        slug: invitation.organization_slug,
      },
      role: invitation.role,
      status: this.resolveInvitationStatus(invitation),
    };
  }

  async accept(input: AcceptInvitationDto, user: AuthUser) {
    const invitation = await this.findInvitationByToken(input.token);
    const normalizedUserEmail = this.tokenService.normalizeEmail(user.email);

    if (normalizedUserEmail !== invitation.email) {
      throw new ForbiddenException(
        'Sign in with the invited email address to accept this invitation',
      );
    }

    if (invitation.status === 'accepted') {
      if (invitation.accepted_user_id === user.id) {
        return this.acceptedResponse(invitation.accepted_by_member_id);
      }

      throw new ConflictException('This invitation has already been accepted');
    }

    if (this.resolveInvitationStatus(invitation) !== 'pending') {
      throw new BadRequestException('This invitation is no longer active');
    }

    return (this.db as any).transaction().execute(async (trx) => {
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
          metadata: { email: invitation.email, role: invitation.role },
          organization_id: invitation.organization_id,
          target_id: invitation.id,
          target_type: 'invitation',
        })
        .execute();

      return this.acceptedResponse(member.id);
    });
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

  private serializeInvitation(invitation: any) {
    const { token_hash: _tokenHash, ...safeInvitation } = invitation;
    return safeInvitation;
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
