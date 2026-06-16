import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateDivisionDto } from './dto/create-division.dto';
import { UpdateDivisionDto } from './dto/update-division.dto';

@Injectable()
export class DivisionService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createDivisionDto: CreateDivisionDto) {
    await this.assertLeagueSeasonBelongsToOrganization(
      organizationId,
      createDivisionDto.leagueSeasonId,
    );
    await this.ensureSlugAvailable(
      createDivisionDto.leagueSeasonId,
      createDivisionDto.slug,
    );

    return this.db
      .insertInto('admin.divisions')
      .values({
        league_season_id: createDivisionDto.leagueSeasonId,
        name: createDivisionDto.name,
        slug: createDivisionDto.slug,
        status: createDivisionDto.status ?? 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findAll(organizationId: string) {
    return this.db
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
      .execute();
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

    if (updateDivisionDto.slug && updateDivisionDto.slug !== division.slug) {
      await this.ensureSlugAvailable(
        division.league_season_id,
        updateDivisionDto.slug,
      );
    }

    return this.db
      .updateTable('admin.divisions')
      .set({
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
