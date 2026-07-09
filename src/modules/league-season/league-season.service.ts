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
import type { PaginationQueryDto } from '../../common/pagination/pagination.dto';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';

@Injectable()
export class LeagueSeasonService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    organizationId: string,
    createLeagueSeasonDto: CreateLeagueSeasonDto,
  ) {
    await this.assertOrganizationExists(organizationId);
    await this.ensureSlugAvailable(organizationId, createLeagueSeasonDto.slug);

    return this.db
      .insertInto('admin.league_seasons')
      .values({
        name: createLeagueSeasonDto.name,
        organization_id: organizationId,
        public_enabled: createLeagueSeasonDto.publicEnabled ?? false,
        slug: createLeagueSeasonDto.slug,
        status: createLeagueSeasonDto.status ?? 'draft',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findAll(organizationId: string, query: PaginationQueryDto) {
    const pagination = normalizePagination(query);
    const total = await this.db
      .selectFrom('admin.league_seasons')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('organization_id', '=', organizationId)
      .executeTakeFirstOrThrow();
    const data = await this.db
      .selectFrom('admin.league_seasons')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at asc')
      .limit(pagination.limit)
      .offset(pagination.offset)
      .execute();

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(organizationId: string, leagueSeasonId: string) {
    const leagueSeason = await this.db
      .selectFrom('admin.league_seasons')
      .selectAll()
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!leagueSeason) {
      throw new NotFoundException('League season not found');
    }

    return leagueSeason;
  }

  async update(
    organizationId: string,
    leagueSeasonId: string,
    updateLeagueSeasonDto: UpdateLeagueSeasonDto,
  ) {
    const leagueSeason = await this.findOne(organizationId, leagueSeasonId);

    if (
      updateLeagueSeasonDto.slug &&
      updateLeagueSeasonDto.slug !== leagueSeason.slug
    ) {
      await this.ensureSlugAvailable(
        organizationId,
        updateLeagueSeasonDto.slug,
      );
    }

    return this.db
      .updateTable('admin.league_seasons')
      .set({
        name: updateLeagueSeasonDto.name,
        public_enabled: updateLeagueSeasonDto.publicEnabled,
        slug: updateLeagueSeasonDto.slug,
        status: updateLeagueSeasonDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(organizationId: string, leagueSeasonId: string) {
    await this.findOne(organizationId, leagueSeasonId);

    await this.db
      .deleteFrom('admin.league_seasons')
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId)
      .execute();

    return { success: true };
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

  private async ensureSlugAvailable(
    organizationId: string,
    slug: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('admin.league_seasons')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('slug', '=', slug)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'League season slug already exists in this organization',
      );
    }
  }
}
