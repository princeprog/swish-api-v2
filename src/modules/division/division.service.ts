import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { serializeJsonArray } from '../../common/database/json-value';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';

@Injectable()
export class DivisionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createDivisionDto: CreateDivisionDto) {
    const season = await this.assertLeagueSeasonBelongsToOrganization(
      organizationId,
      createDivisionDto.leagueSeasonId,
    );
    await this.ensureSlugAvailable(
      createDivisionDto.leagueSeasonId,
      createDivisionDto.slug,
    );

    return this.db.transaction().execute(async (trx) => {
      const division = await trx
        .insertInto('admin.divisions')
        .values({
          league_season_id: createDivisionDto.leagueSeasonId,
          name: createDivisionDto.name,
          slug: createDivisionDto.slug,
          status: createDivisionDto.status ?? 'active',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('admin.division_roster_settings')
        .values({ division_id: division.id })
        .onConflict((oc) => oc.column('division_id').doNothing())
        .execute();

      const format = await trx
        .insertInto('competition.division_formats')
        .values({
          crossover_template: serializeJsonArray(
            season.default_crossover_template as unknown[],
          ),
          division_id: division.id,
          playoff_format: season.default_playoff_format,
          pool_count: season.default_pool_count,
          qualifiers_per_pool: season.default_qualifiers_per_pool,
          qualifying_format: season.default_qualifying_format,
          tiebreakers: serializeJsonArray(
            season.default_tiebreakers as unknown[],
          ),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('competition.pools')
        .values(
          Array.from({ length: season.default_pool_count }, (_, index) => {
            const code = String.fromCharCode(65 + index);

            return {
              code,
              division_format_id: format.id,
              name: `Pool ${code}`,
              sort_order: index + 1,
            };
          }),
        )
        .execute();

      return division;
    });
  }

  async findAll(organizationId: string, query: PaginationQueryDto) {
    const pagination = normalizePagination(query);
    const total = await this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select((eb) => eb.fn.countAll().as('count'))
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirstOrThrow();
    const data = await this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'divisions.created_at',
        'divisions.id',
        'divisions.league_season_id',
        'divisions.name',
        'divisions.slug',
        'divisions.status',
        'divisions.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .orderBy('divisions.created_at asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(organizationId: string, divisionId: string) {
    const division = await this.db
      .selectFrom('admin.divisions as divisions')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'divisions.created_at',
        'divisions.id',
        'divisions.league_season_id',
        'divisions.name',
        'divisions.slug',
        'divisions.status',
        'divisions.updated_at',
      ])
      .where('divisions.id', '=', divisionId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!division) {
      throw new NotFoundException('Division not found');
    }

    return division;
  }

  async update(
    organizationId: string,
    divisionId: string,
    updateDivisionDto: UpdateDivisionDto,
  ) {
    const division = await this.findOne(organizationId, divisionId);
    const targetLeagueSeasonId =
      updateDivisionDto.leagueSeasonId ?? division.league_season_id;

    if (
      updateDivisionDto.leagueSeasonId &&
      updateDivisionDto.leagueSeasonId !== division.league_season_id
    ) {
      await this.assertLeagueSeasonBelongsToOrganization(
        organizationId,
        updateDivisionDto.leagueSeasonId,
      );
    }

    if (
      (updateDivisionDto.slug && updateDivisionDto.slug !== division.slug) ||
      targetLeagueSeasonId !== division.league_season_id
    ) {
      await this.ensureSlugAvailable(
        targetLeagueSeasonId,
        updateDivisionDto.slug ?? division.slug,
      );
    }

    return this.db
      .updateTable('admin.divisions')
      .set({
        league_season_id: updateDivisionDto.leagueSeasonId,
        name: updateDivisionDto.name,
        slug: updateDivisionDto.slug,
        status: updateDivisionDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', divisionId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(organizationId: string, divisionId: string) {
    await this.findOne(organizationId, divisionId);

    await this.db
      .deleteFrom('admin.divisions')
      .where('id', '=', divisionId)
      .execute();

    return { success: true };
  }

  private async assertLeagueSeasonBelongsToOrganization(
    organizationId: string,
    leagueSeasonId: string,
  ) {
    const leagueSeason = await this.db
      .selectFrom('admin.league_seasons')
      .select([
        'default_crossover_template',
        'default_playoff_format',
        'default_pool_count',
        'default_qualifiers_per_pool',
        'default_qualifying_format',
        'default_tiebreakers',
        'id',
      ])
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!leagueSeason) {
      throw new NotFoundException(
        'League season not found in this organization',
      );
    }

    return leagueSeason;
  }

  private async ensureSlugAvailable(
    leagueSeasonId: string,
    slug: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('admin.divisions')
      .select(['id'])
      .where('league_season_id', '=', leagueSeasonId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'Division slug already exists in this league season',
      );
    }
  }
}
