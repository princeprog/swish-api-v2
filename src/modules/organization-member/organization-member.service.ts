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
  type AuthRole,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Injectable()
export class OrganizationMemberService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    createOrganizationMemberDto: CreateOrganizationMemberDto,
  ) {
    await this.assertOrganizationExists(organizationId);
    await this.assertUserExists(createOrganizationMemberDto.userId);

    const existing = await this.db
      .selectFrom('admin.organization_members')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', createOrganizationMemberDto.userId)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    const member = await this.db
      .insertInto('admin.organization_members')
      .values({
        organization_id: organizationId,
        role: createOrganizationMemberDto.role,
        status: createOrganizationMemberDto.status ?? 'active',
        user_id: createOrganizationMemberDto.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(access, 'member.created', 'member', member.id, {
      role: member.role,
      status: member.status,
    });

    return member;
  }

  async findAll(organizationId: string) {
    const members = await this.db
      .selectFrom('admin.organization_members as members')
      .innerJoin('auth.users as users', 'users.id', 'members.user_id')
      .select([
        'members.created_at',
        'members.id',
        'members.organization_id',
        'members.role',
        'members.status',
        'members.updated_at',
        'members.user_id',
        'users.email',
        'users.name',
      ])
      .where('members.organization_id', '=', organizationId)
      .orderBy('members.created_at asc')
      .execute();

    const memberIds = members.map((member) => member.id);
    const teamAssignments = await this.findTeamAssignments(memberIds);

    return members.map((member) => ({
      ...member,
      teamAssignments: teamAssignments.get(member.id) ?? [],
    }));
  }

  async findOne(organizationId: string, memberId: string) {
    const member = await this.db
      .selectFrom('admin.organization_members')
      .selectAll()
      .where('id', '=', memberId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!member) {
      throw new NotFoundException('Organization member not found');
    }

    return member;
  }

  async update(
    organizationId: string,
    memberId: string,
    access: OrganizationAccessContext,
    updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    const member = await this.findOne(organizationId, memberId);

    if (member.id === access.membershipId) {
      if (
        updateOrganizationMemberDto.role &&
        updateOrganizationMemberDto.role !== member.role
      ) {
        throw new ForbiddenException('Owners cannot change their own role');
      }

      if (
        updateOrganizationMemberDto.status &&
        updateOrganizationMemberDto.status !== member.status
      ) {
        throw new ForbiddenException('Owners cannot suspend themselves');
      }
    }

    if (member.role === AUTH_ROLES.OWNER) {
      throw new BadRequestException('Use ownership transfer to change owner');
    }

    const updated = await (this.db as any)
      .transaction()
      .execute(async (trx) => {
        const nextRole =
          (updateOrganizationMemberDto.role as AuthRole | undefined) ??
          (member.role as AuthRole);

        if (updateOrganizationMemberDto.role) {
          await this.clearIncompatibleAssignmentsInTransaction(
            trx,
            memberId,
            nextRole,
          );
        }

        if (
          updateOrganizationMemberDto.status &&
          updateOrganizationMemberDto.status !== 'active'
        ) {
          await this.clearAllAssignmentsInTransaction(trx, memberId);
        }

        return trx
          .updateTable('admin.organization_members')
          .set({
            role: updateOrganizationMemberDto.role,
            status: updateOrganizationMemberDto.status,
            updated_at: new Date(),
          })
          .where('id', '=', memberId)
          .returningAll()
          .executeTakeFirstOrThrow();
      });

    await this.writeAudit(access, 'member.updated', 'member', memberId, {
      role: updated.role,
      status: updated.status,
    });

    return updated;
  }

  async updateTeamAssignments(
    organizationId: string,
    memberId: string,
    access: OrganizationAccessContext,
    teamIds: string[],
  ) {
    const member = await this.findOne(organizationId, memberId);

    if (member.role !== AUTH_ROLES.TEAM_MANAGER || member.status !== 'active') {
      throw new BadRequestException(
        'Team assignments require an active team manager',
      );
    }

    const teams = await this.findAssignableTeams(organizationId, teamIds);
    this.assertOneTeamPerSeason(teams);

    await (this.db as any).transaction().execute(async (trx) => {
      await trx
        .deleteFrom('access.team_manager_assignments')
        .where('organization_member_id', '=', memberId)
        .execute();

      if (teamIds.length) {
        await trx
          .insertInto('access.team_manager_assignments')
          .values(
            teams.map((team) => ({
              league_season_id: team.league_season_id,
              organization_member_id: memberId,
              team_id: team.id,
            })),
          )
          .execute();
      }
    });

    await this.writeAudit(
      access,
      'member.team_assignments.updated',
      'member',
      memberId,
      {
        teamIds,
      },
    );

    return { success: true, teamIds };
  }

  async transferOwnership(
    organizationId: string,
    access: OrganizationAccessContext,
    transferOwnershipDto: TransferOwnershipDto,
  ) {
    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['slug'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (transferOwnershipDto.confirmationSlug !== organization.slug) {
      throw new BadRequestException('Confirmation slug does not match');
    }

    const target = await this.findOne(
      organizationId,
      transferOwnershipDto.targetMemberId,
    );

    if (target.role !== AUTH_ROLES.ADMIN || target.status !== 'active') {
      throw new BadRequestException(
        'Ownership can transfer only to an active admin',
      );
    }

    await (this.db as any).transaction().execute(async (trx) => {
      await trx
        .updateTable('admin.organization_members')
        .set({
          role: AUTH_ROLES.ADMIN,
          updated_at: new Date(),
        })
        .where('id', '=', access.membershipId)
        .where('organization_id', '=', organizationId)
        .where('role', '=', AUTH_ROLES.OWNER)
        .execute();

      await trx
        .updateTable('admin.organization_members')
        .set({
          role: AUTH_ROLES.OWNER,
          updated_at: new Date(),
        })
        .where('id', '=', target.id)
        .where('organization_id', '=', organizationId)
        .where('status', '=', 'active')
        .execute();
    });

    await this.writeAudit(
      access,
      'ownership.transferred',
      'member',
      transferOwnershipDto.targetMemberId,
      { previousOwnerMemberId: access.membershipId },
    );

    return { success: true };
  }

  private async clearIncompatibleAssignmentsInTransaction(
    trx: any,
    memberId: string,
    role: AuthRole,
  ) {
    if (role !== AUTH_ROLES.TEAM_MANAGER) {
      await trx
        .deleteFrom('access.team_manager_assignments')
        .where('organization_member_id', '=', memberId)
        .execute();
    }

    if (role !== AUTH_ROLES.SCOREKEEPER) {
      await trx
        .deleteFrom('access.game_scorekeeper_assignments')
        .where('organization_member_id', '=', memberId)
        .execute();
    }
  }

  private async clearAllAssignmentsInTransaction(trx: any, memberId: string) {
    await trx
      .deleteFrom('access.team_manager_assignments')
      .where('organization_member_id', '=', memberId)
      .execute();

    await trx
      .deleteFrom('access.game_scorekeeper_assignments')
      .where('organization_member_id', '=', memberId)
      .execute();
  }

  private async findTeamAssignments(memberIds: string[]) {
    const byMember = new Map<string, unknown[]>();

    if (!memberIds.length) {
      return byMember;
    }

    const rows = await (this.db as any)
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin('admin.teams as teams', 'teams.id', 'assignments.team_id')
      .select([
        'assignments.organization_member_id',
        'teams.id',
        'teams.name',
        'teams.slug',
      ])
      .where('assignments.organization_member_id', 'in', memberIds)
      .execute();

    for (const row of rows) {
      const values = byMember.get(row.organization_member_id) ?? [];
      values.push({ id: row.id, name: row.name, slug: row.slug });
      byMember.set(row.organization_member_id, values);
    }

    return byMember;
  }

  private async assertTeamsBelongToOrganization(
    organizationId: string,
    teamIds: string[],
  ) {
    await this.findAssignableTeams(organizationId, teamIds);
  }

  private async findAssignableTeams(organizationId: string, teamIds: string[]) {
    if (!teamIds.length) {
      return [];
    }

    const rows = await this.db
      .selectFrom('admin.teams as teams')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select(['teams.id', 'divisions.league_season_id'])
      .where('teams.id', 'in', teamIds)
      .where('league_seasons.organization_id', '=', organizationId)
      .execute();

    if (rows.length !== teamIds.length) {
      throw new NotFoundException('One or more teams were not found');
    }

    return rows;
  }

  private assertOneTeamPerSeason(
    teams: Array<{ id: string; league_season_id: string }>,
  ) {
    const selectedSeasonIds = new Set<string>();

    for (const team of teams) {
      if (selectedSeasonIds.has(team.league_season_id)) {
        throw new BadRequestException(
          'A team manager can only manage one team in each season.',
        );
      }

      selectedSeasonIds.add(team.league_season_id);
    }
  }

  private async assertOrganizationExists(
    organizationId: string,
  ): Promise<void> {
    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['id'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException('User not found');
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
