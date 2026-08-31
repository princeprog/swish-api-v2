import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import {
  archiveRecord,
  restoreRecord,
  writeArchiveAudit,
} from '../../common/archival/archival';

@Injectable()
export class VenueService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createVenueDto: CreateVenueDto) {
    await this.assertLeagueSeasonBelongsToOrganization(
      organizationId,
      createVenueDto.leagueSeasonId,
    );
    await this.ensureSlugAvailable(
      createVenueDto.leagueSeasonId,
      createVenueDto.slug,
    );

    return this.db
      .insertInto('admin.venues')
      .values({
        league_season_id: createVenueDto.leagueSeasonId,
        name: createVenueDto.name,
        slug: createVenueDto.slug,
        status: createVenueDto.status ?? 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findAll(organizationId: string, query: PaginationQueryDto) {
    const pagination = normalizePagination(query);
    const total = await this.db
      .selectFrom('admin.venues as venues')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'venues.league_season_id',
      )
      .select((eb) => eb.fn.countAll().as('count'))
      .where('league_seasons.organization_id', '=', organizationId)
      .where('league_seasons.archived_at', 'is', null)
      .where('venues.archived_at', 'is', null)
      .executeTakeFirstOrThrow();
    const data = await this.db
      .selectFrom('admin.venues as venues')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'venues.league_season_id',
      )
      .select([
        'venues.created_at',
        'venues.archived_at',
        'venues.id',
        'venues.league_season_id',
        'venues.name',
        'venues.slug',
        'venues.status',
        'venues.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .where('league_seasons.archived_at', 'is', null)
      .where('venues.archived_at', 'is', null)
      .orderBy('venues.created_at asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(organizationId: string, venueId: string) {
    const venue = await this.db
      .selectFrom('admin.venues as venues')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'venues.league_season_id',
      )
      .select([
        'venues.created_at',
        'venues.archived_at',
        'venues.id',
        'venues.league_season_id',
        'venues.name',
        'venues.slug',
        'venues.status',
        'venues.updated_at',
      ])
      .where('venues.id', '=', venueId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    return venue;
  }

  async update(
    organizationId: string,
    venueId: string,
    updateVenueDto: UpdateVenueDto,
  ) {
    const venue = await this.findOne(organizationId, venueId);
    if (venue.archived_at) {
      throw new ConflictException(
        'This venue is archived. Restore it before making changes.',
      );
    }
    const targetLeagueSeasonId =
      updateVenueDto.leagueSeasonId ?? venue.league_season_id;

    if (
      updateVenueDto.leagueSeasonId &&
      updateVenueDto.leagueSeasonId !== venue.league_season_id
    ) {
      await this.assertLeagueSeasonBelongsToOrganization(
        organizationId,
        updateVenueDto.leagueSeasonId,
      );
    }

    if (
      (updateVenueDto.slug && updateVenueDto.slug !== venue.slug) ||
      targetLeagueSeasonId !== venue.league_season_id
    ) {
      await this.ensureSlugAvailable(
        targetLeagueSeasonId,
        updateVenueDto.slug ?? venue.slug,
      );
    }

    return this.db
      .updateTable('admin.venues')
      .set({
        league_season_id: updateVenueDto.leagueSeasonId,
        name: updateVenueDto.name,
        slug: updateVenueDto.slug,
        status: updateVenueDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', venueId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(
    organizationId: string,
    venueId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.archive(organizationId, venueId, access);
  }

  async archive(
    organizationId: string,
    venueId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const venue = await trx
        .selectFrom('admin.venues as venues')
        .innerJoin(
          'admin.league_seasons as seasons',
          'seasons.id',
          'venues.league_season_id',
        )
        .select([
          'venues.archived_at',
          'venues.id',
          'seasons.archived_at as season_archived_at',
        ])
        .where('venues.id', '=', venueId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!venue) throw new NotFoundException('Venue not found');
      if (venue.archived_at) return venue;

      const openGame = await trx
        .selectFrom('competition.games')
        .select('id')
        .where('venue_id', '=', venueId)
        .where('archived_at', 'is', null)
        .where('status', 'in', ['live', 'reopened'])
        .executeTakeFirst();
      if (openGame) {
        throw new ConflictException(
          'Finish or reopen the active games before archiving this venue.',
        );
      }

      const archived = await archiveRecord(trx, 'admin.venues', venueId);
      await writeArchiveAudit(trx, {
        action: 'venue.archived',
        actor: access,
        organizationId,
        targetId: venueId,
        targetType: 'venue',
      });
      return archived;
    });
  }

  async restore(
    organizationId: string,
    venueId: string,
    access?: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const venue = await trx
        .selectFrom('admin.venues as venues')
        .innerJoin(
          'admin.league_seasons as seasons',
          'seasons.id',
          'venues.league_season_id',
        )
        .select([
          'venues.archived_at',
          'venues.id',
          'seasons.archived_at as season_archived_at',
        ])
        .where('venues.id', '=', venueId)
        .where('seasons.organization_id', '=', organizationId)
        .forUpdate()
        .executeTakeFirst();
      if (!venue) throw new NotFoundException('Venue not found');
      if (!venue.archived_at) return venue;
      if (venue.season_archived_at) {
        throw new ConflictException(
          'Restore the league season before restoring this venue.',
        );
      }

      const restored = await restoreRecord(trx, 'admin.venues', venueId);
      await writeArchiveAudit(trx, {
        action: 'venue.restored',
        actor: access,
        organizationId,
        targetId: venueId,
        targetType: 'venue',
      });
      return restored;
    });
  }

  private async assertLeagueSeasonBelongsToOrganization(
    organizationId: string,
    leagueSeasonId: string,
  ): Promise<void> {
    const leagueSeason = await this.db
      .selectFrom('admin.league_seasons')
      .select(['id'])
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();

    if (!leagueSeason) {
      throw new NotFoundException(
        'League season not found in this organization',
      );
    }
  }

  private async ensureSlugAvailable(
    leagueSeasonId: string,
    slug: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('admin.venues')
      .select(['id'])
      .where('league_season_id', '=', leagueSeasonId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'Venue slug already exists in this league season',
      );
    }
  }
}
