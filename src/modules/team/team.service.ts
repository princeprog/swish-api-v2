import {
  ForbiddenException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateTeamDto } from './dto/create-team.dto';
import type { TeamListQueryDto } from './dto/team-list-query.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import {
  archiveRecord,
  restoreRecord,
  writeArchiveAudit,
} from '../../common/archival/archival';

@Injectable()
export class TeamService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createTeamDto: CreateTeamDto) {
    await this.assertDivisionBelongsToOrganization(
      organizationId,
      createTeamDto.divisionId,
    );
    await this.ensureSlugAvailable(
      createTeamDto.divisionId,
      createTeamDto.slug,
    );

    const team = await this.db
      .insertInto('admin.teams')
      .values({
        color: createTeamDto.color ?? null,
        division_id: createTeamDto.divisionId,
        name: createTeamDto.name,
        slug: createTeamDto.slug,
        status: createTeamDto.status ?? 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('admin.team_rosters')
      .values({ team_id: team.id })
      .onConflict((oc) => oc.column('team_id').doNothing())
      .execute();

    return team;
  }

  async findAll(
    organizationId: string,
    access: OrganizationAccessContext,
    query: TeamListQueryDto,
  ) {
    const pagination = normalizePagination(query);
    let countQuery = this.db
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
      .select((eb) => eb.fn.countAll().as('count'))
      .where('league_seasons.organization_id', '=', organizationId)
      .where('league_seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
      .where('teams.archived_at', 'is', null);
    let dataQuery = this.db
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
      .select([
        'teams.color',
        'teams.created_at',
        'teams.archived_at',
        'teams.division_id',
        'teams.id',
        'divisions.name as division_name',
        'league_seasons.id as league_season_id',
        'league_seasons.name as league_season_name',
        'teams.name',
        'teams.slug',
        'teams.status',
        'teams.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId);
    dataQuery = dataQuery
      .where('league_seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
      .where('teams.archived_at', 'is', null);

    if (
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED,
      ) &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_READ)
    ) {
      countQuery = countQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'teams.id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
      dataQuery = dataQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'teams.id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
    } else if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_READ)
    ) {
      throw new ForbiddenException('You cannot read organization teams');
    }

    if (query.search) {
      const search = `%${query.search}%`;
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('teams.name', 'ilike', search),
          eb('teams.slug', 'ilike', search),
        ]),
      );
      dataQuery = dataQuery.where((eb) =>
        eb.or([
          eb('teams.name', 'ilike', search),
          eb('teams.slug', 'ilike', search),
        ]),
      );
    }

    if (query.divisionId) {
      countQuery = countQuery.where('teams.division_id', '=', query.divisionId);
      dataQuery = dataQuery.where('teams.division_id', '=', query.divisionId);
    }

    if (query.status) {
      countQuery = countQuery.where('teams.status', '=', query.status);
      dataQuery = dataQuery.where('teams.status', '=', query.status);
    }

    if (query.sortBy === 'name') {
      dataQuery = dataQuery.orderBy('teams.name asc');
    } else if (query.sortBy === 'division') {
      dataQuery = dataQuery
        .orderBy('divisions.name asc')
        .orderBy('teams.name asc');
    } else {
      dataQuery = dataQuery.orderBy('teams.updated_at desc');
    }

    const [total, data] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      dataQuery.limit(pagination.limit).offset(pagination.offset).execute(),
    ]);

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(
    organizationId: string,
    teamId: string,
    access?: OrganizationAccessContext,
  ) {
    let teamQuery = this.db
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
      .select([
        'teams.color',
        'teams.created_at',
        'teams.archived_at',
        'teams.division_id',
        'teams.id',
        'divisions.name as division_name',
        'league_seasons.id as league_season_id',
        'league_seasons.name as league_season_name',
        'teams.name',
        'teams.slug',
        'teams.status',
        'teams.updated_at',
      ])
      .where('teams.id', '=', teamId)
      .where('league_seasons.organization_id', '=', organizationId);

    if (
      access &&
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED,
      ) &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_READ)
    ) {
      teamQuery = teamQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'teams.id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
    } else if (
      access &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_READ)
    ) {
      throw new ForbiddenException('You cannot read organization teams');
    }

    const team = await teamQuery.executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    return team;
  }

  async update(
    organizationId: string,
    teamId: string,
    access: OrganizationAccessContext,
    updateTeamDto: UpdateTeamDto,
  ) {
    if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_UPDATE) &&
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.TEAMS_UPDATE_ASSIGNED,
      )
    ) {
      throw new ForbiddenException('You cannot update teams');
    }

    const isAssignedTeamUpdate =
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.TEAMS_UPDATE_ASSIGNED,
      ) && !access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_UPDATE);

    if (
      isAssignedTeamUpdate &&
      (updateTeamDto.divisionId ||
        updateTeamDto.slug ||
        updateTeamDto.status !== undefined)
    ) {
      throw new ForbiddenException(
        'Team managers can update only the team name and color.',
      );
    }

    const team = await this.findOne(organizationId, teamId, {
      ...access,
      permissions: access.permissions.includes(
        ORGANIZATION_PERMISSIONS.TEAMS_UPDATE,
      )
        ? [ORGANIZATION_PERMISSIONS.TEAMS_READ]
        : [ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED],
    });

    if (team.archived_at) {
      throw new ConflictException(
        'This team is archived. Restore it before making changes.',
      );
    }
    const targetDivisionId = updateTeamDto.divisionId ?? team.division_id;

    if (
      updateTeamDto.divisionId &&
      updateTeamDto.divisionId !== team.division_id
    ) {
      await this.assertDivisionBelongsToOrganization(
        organizationId,
        updateTeamDto.divisionId,
      );
    }

    if (
      (updateTeamDto.slug && updateTeamDto.slug !== team.slug) ||
      targetDivisionId !== team.division_id
    ) {
      await this.ensureSlugAvailable(
        targetDivisionId,
        updateTeamDto.slug ?? team.slug,
      );
    }

    const updated = await this.db
      .updateTable('admin.teams')
      .set({
        color: updateTeamDto.color ?? team.color,
        division_id: updateTeamDto.divisionId,
        name: updateTeamDto.name,
        slug: updateTeamDto.slug,
        status: updateTeamDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', teamId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.writeAudit(access, 'team.profile.updated', 'team', teamId, {
      name: updated.name,
      color: updated.color,
    });

    return updated;
  }

  async remove(
    organizationId: string,
    teamId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.archive(organizationId, teamId, access);
  }

  async archive(
    organizationId: string,
    teamId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const team = await trx
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
          'teams.archived_at',
          'teams.id',
          'divisions.archived_at as division_archived_at',
          'seasons.archived_at as season_archived_at',
        ])
        .where('teams.id', '=', teamId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!team) throw new NotFoundException('Team not found');
      if (team.archived_at) return team;

      const openGame = await trx
        .selectFrom('competition.games')
        .select('id')
        .where((eb) =>
          eb.or([
            eb('home_team_id', '=', teamId),
            eb('away_team_id', '=', teamId),
          ]),
        )
        .where('archived_at', 'is', null)
        .where('status', 'in', ['live', 'reopened'])
        .executeTakeFirst();
      if (openGame) {
        throw new ConflictException(
          'Finish or reopen the active games before archiving this team.',
        );
      }

      const archived = await archiveRecord(trx, 'admin.teams', teamId);
      await writeArchiveAudit(trx, {
        action: 'team.archived',
        actor: access,
        organizationId,
        targetId: teamId,
        targetType: 'team',
      });
      return archived;
    });
  }

  async restore(
    organizationId: string,
    teamId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const team = await trx
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
          'teams.archived_at',
          'teams.id',
          'divisions.archived_at as division_archived_at',
          'seasons.archived_at as season_archived_at',
        ])
        .where('teams.id', '=', teamId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!team) throw new NotFoundException('Team not found');
      if (!team.archived_at) return team;
      if (team.division_archived_at || team.season_archived_at) {
        throw new ConflictException(
          'Restore the league season and division before restoring this team.',
        );
      }

      const restored = await restoreRecord(trx, 'admin.teams', teamId);
      await writeArchiveAudit(trx, {
        action: 'team.restored',
        actor: access,
        organizationId,
        targetId: teamId,
        targetType: 'team',
      });
      return restored;
    });
  }

  private async assertDivisionBelongsToOrganization(
    organizationId: string,
    divisionId: string,
  ): Promise<void> {
    const division = await this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select(['divisions.id'])
      .where('divisions.id', '=', divisionId)
      .where('league_seasons.organization_id', '=', organizationId)
      .where('divisions.archived_at', 'is', null)
      .where('league_seasons.archived_at', 'is', null)
      .executeTakeFirst();

    if (!division) {
      throw new NotFoundException('Division not found in this organization');
    }
  }

  private async ensureSlugAvailable(
    divisionId: string,
    slug: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('admin.teams')
      .select(['id'])
      .where('division_id', '=', divisionId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException('Team slug already exists in this division');
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
