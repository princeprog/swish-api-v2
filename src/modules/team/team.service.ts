import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateTeamDto } from './dto/create-team.dto';
import type { TeamListQueryDto } from './dto/team-list-query.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Injectable()
export class TeamService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createTeamDto: CreateTeamDto) {
    await this.assertDivisionBelongsToOrganization(
      organizationId,
      createTeamDto.divisionId,
    );
    await this.ensureSlugAvailable(createTeamDto.divisionId, createTeamDto.slug);

    return this.db
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
  }

  async findAll(organizationId: string, query: TeamListQueryDto) {
    const pagination = normalizePagination(query);
    let countQuery = this.db
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select((eb) => eb.fn.countAll().as('count'))
      .where('league_seasons.organization_id', '=', organizationId);
    let dataQuery = this.db
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'teams.color',
        'teams.created_at',
        'teams.division_id',
        'teams.id',
        'teams.name',
        'teams.slug',
        'teams.status',
        'teams.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId);

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
      dataQuery = dataQuery.orderBy('divisions.name asc').orderBy('teams.name asc');
    } else {
      dataQuery = dataQuery.orderBy('teams.updated_at desc');
    }

    const [total, data] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      dataQuery
        .limit(pagination.limit)
        .offset(pagination.offset)
        .execute(),
    ]);

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(organizationId: string, teamId: string) {
    const team = await this.db
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'teams.color',
        'teams.created_at',
        'teams.division_id',
        'teams.id',
        'teams.name',
        'teams.slug',
        'teams.status',
        'teams.updated_at',
      ])
      .where('teams.id', '=', teamId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    return team;
  }

  async update(
    organizationId: string,
    teamId: string,
    updateTeamDto: UpdateTeamDto,
  ) {
    const team = await this.findOne(organizationId, teamId);
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

    return this.db
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
  }

  async remove(organizationId: string, teamId: string) {
    await this.findOne(organizationId, teamId);

    await this.db.deleteFrom('admin.teams').where('id', '=', teamId).execute();

    return { success: true };
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
}
