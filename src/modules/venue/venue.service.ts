import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';

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

  findAll(organizationId: string) {
    return this.db
      .selectFrom('admin.venues as venues')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'venues.league_season_id',
      )
      .select([
        'venues.created_at',
        'venues.id',
        'venues.league_season_id',
        'venues.name',
        'venues.slug',
        'venues.status',
        'venues.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .orderBy('venues.created_at asc')
      .execute();
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

  async remove(organizationId: string, venueId: string) {
    await this.findOne(organizationId, venueId);

    await this.db.deleteFrom('admin.venues').where('id', '=', venueId).execute();

    return { success: true };
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
