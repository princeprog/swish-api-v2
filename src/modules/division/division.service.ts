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
import type { OrganizationAccessContext } from '../../common/auth/roles';
import {
  archiveRecord,
  restoreRecord,
  writeArchiveAudit,
} from '../../common/archival/archival';

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
      .where('league_seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
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
        'divisions.archived_at',
        'divisions.id',
        'divisions.league_season_id',
        'divisions.name',
        'divisions.slug',
        'divisions.status',
        'divisions.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .where('league_seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
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
        'divisions.archived_at',
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

    if (division.archived_at) {
      throw new ConflictException(
        'This division is archived. Restore it before making changes.',
      );
    }
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

  async remove(
    organizationId: string,
    divisionId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.archive(organizationId, divisionId, access);
  }

  async archive(
    organizationId: string,
    divisionId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const division = await trx
        .selectFrom('admin.divisions as divisions')
        .innerJoin(
          'admin.league_seasons as seasons',
          'seasons.id',
          'divisions.league_season_id',
        )
        .select([
          'divisions.archived_at',
          'divisions.id',
          'seasons.id as league_season_id',
        ])
        .where('divisions.id', '=', divisionId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!division) throw new NotFoundException('Division not found');
      if (division.archived_at) return division;

      const openGame = await trx
        .selectFrom('competition.games')
        .select('id')
        .where('division_id', '=', divisionId)
        .where('archived_at', 'is', null)
        .where('status', 'in', ['live', 'reopened'])
        .executeTakeFirst();
      if (openGame) {
        throw new ConflictException(
          'Finish or reopen the active games before archiving this division.',
        );
      }

      const archived = await archiveRecord(trx, 'admin.divisions', divisionId);
      await writeArchiveAudit(trx, {
        action: 'division.archived',
        actor: access,
        organizationId,
        targetId: divisionId,
        targetType: 'division',
      });
      return archived;
    });
  }

  async restore(
    organizationId: string,
    divisionId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const division = await trx
        .selectFrom('admin.divisions as divisions')
        .innerJoin(
          'admin.league_seasons as seasons',
          'seasons.id',
          'divisions.league_season_id',
        )
        .select([
          'divisions.archived_at',
          'divisions.id',
          'seasons.archived_at as season_archived_at',
        ])
        .where('divisions.id', '=', divisionId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!division) throw new NotFoundException('Division not found');
      if (!division.archived_at) return division;
      if (division.season_archived_at) {
        throw new ConflictException(
          'Restore the league season before restoring this division.',
        );
      }

      const restored = await restoreRecord(trx, 'admin.divisions', divisionId);
      await writeArchiveAudit(trx, {
        action: 'division.restored',
        actor: access,
        organizationId,
        targetId: divisionId,
        targetType: 'division',
      });
      return restored;
    });
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
      .where('archived_at', 'is', null)
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
