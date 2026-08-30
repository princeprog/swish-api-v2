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
import { serializeJsonArray } from '../../common/database/json-value';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';
import type { LeagueSeasonGameRulesDto } from './dto/league-season-game-rules.dto';
import type { LeagueSeasonCompetitionDefaultsDto } from './dto/league-season-competition-defaults.dto';

type LeagueSeasonRecord = {
  created_at: Date;
  default_crossover_template: unknown;
  default_playoff_format: string;
  default_pool_count: number;
  default_qualifiers_per_pool: number;
  default_qualifying_format: string;
  default_tiebreakers: unknown;
  id: string;
  name: string;
  organization_id: string;
  public_enabled: boolean;
  schedule_slot_duration_minutes: number;
  slug: string;
  status: string;
  updated_at: Date;
};

type LeagueSeasonGameRulesRecord = {
  created_at: Date;
  league_season_id: string;
  overtime_duration_ms: number;
  period_duration_ms: number;
  personal_foul_limit: number;
  regulation_periods: number;
  shot_clock_enabled: boolean;
  shot_clock_full_ms: number;
  shot_clock_short_ms: number;
  team_fouls_before_penalty: number;
  timeouts_first_half: number;
  timeouts_per_overtime: number;
  timeouts_second_half: number;
  updated_at: Date;
};

function toGameRulesValues(gameRules: LeagueSeasonGameRulesDto) {
  return {
    overtime_duration_ms: gameRules.overtimeDurationMs,
    period_duration_ms: gameRules.periodDurationMs,
    personal_foul_limit: gameRules.personalFoulLimit,
    regulation_periods: gameRules.regulationPeriods,
    shot_clock_enabled: gameRules.shotClockEnabled,
    shot_clock_full_ms: gameRules.shotClockFullMs,
    shot_clock_short_ms: gameRules.shotClockShortMs,
    team_fouls_before_penalty: gameRules.teamFoulsBeforePenalty,
    timeouts_first_half: gameRules.timeoutsFirstHalf,
    timeouts_per_overtime: gameRules.timeoutsPerOvertime,
    timeouts_second_half: gameRules.timeoutsSecondHalf,
  };
}

function toCompetitionValues(
  defaults: LeagueSeasonCompetitionDefaultsDto,
  scheduleSlotDurationMinutes = 90,
) {
  return {
    default_crossover_template: serializeJsonArray(
      defaults.crossoverTemplate.map((matchup) => ({
        awaySeed: matchup.awaySeed,
        homeSeed: matchup.homeSeed,
      })),
    ),
    default_playoff_format: defaults.playoffFormat,
    default_pool_count: defaults.poolCount,
    default_qualifiers_per_pool: defaults.qualifiersPerPool,
    default_qualifying_format: defaults.qualifyingFormat,
    default_tiebreakers: serializeJsonArray(defaults.tiebreakers),
    schedule_slot_duration_minutes: scheduleSlotDurationMinutes,
  };
}

function toLeagueSeasonResponse(
  season: LeagueSeasonRecord,
  gameRules: LeagueSeasonGameRulesRecord,
) {
  const {
    default_crossover_template,
    default_playoff_format,
    default_pool_count,
    default_qualifiers_per_pool,
    default_qualifying_format,
    default_tiebreakers,
    ...seasonDetails
  } = season;
  const {
    created_at: _createdAt,
    league_season_id: _leagueSeasonId,
    updated_at: _updatedAt,
    ...rules
  } = gameRules;

  return {
    ...seasonDetails,
    competition_defaults: {
      crossover_template: default_crossover_template,
      playoff_format: default_playoff_format,
      pool_count: default_pool_count,
      qualifiers_per_pool: default_qualifiers_per_pool,
      qualifying_format: default_qualifying_format,
      tiebreakers: default_tiebreakers,
    },
    game_rules: rules,
  };
}

@Injectable()
export class LeagueSeasonService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    organizationId: string,
    createLeagueSeasonDto: CreateLeagueSeasonDto,
  ) {
    await this.assertOrganizationExists(organizationId);
    await this.ensureSlugAvailable(organizationId, createLeagueSeasonDto.slug);

    return this.db.transaction().execute(async (trx) => {
      const season = await trx
        .insertInto('admin.league_seasons')
        .values({
          ...toCompetitionValues(
            createLeagueSeasonDto.competitionDefaults,
            createLeagueSeasonDto.scheduleSlotDurationMinutes,
          ),
          name: createLeagueSeasonDto.name,
          organization_id: organizationId,
          public_enabled: createLeagueSeasonDto.publicEnabled ?? false,
          slug: createLeagueSeasonDto.slug,
          status: createLeagueSeasonDto.status ?? 'draft',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const gameRules = await trx
        .insertInto('admin.league_season_game_rules')
        .values({
          league_season_id: season.id,
          ...toGameRulesValues(createLeagueSeasonDto.gameRules),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toLeagueSeasonResponse(season, gameRules);
    });
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

    const gameRules = data.length
      ? await this.db
          .selectFrom('admin.league_season_game_rules')
          .selectAll()
          .where(
            'league_season_id',
            'in',
            data.map((season) => season.id),
          )
          .execute()
      : [];
    const rulesBySeasonId = new Map(
      gameRules.map((rules) => [rules.league_season_id, rules]),
    );
    const seasonsWithRules = data.map((season) => {
      const rules = rulesBySeasonId.get(season.id);

      if (!rules) {
        throw new NotFoundException(
          'Game rules were not found for this season',
        );
      }

      return toLeagueSeasonResponse(season, rules);
    });

    return createPaginatedResponse(
      seasonsWithRules,
      Number(total.count),
      pagination,
    );
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

    const gameRules = await this.db
      .selectFrom('admin.league_season_game_rules')
      .selectAll()
      .where('league_season_id', '=', leagueSeasonId)
      .executeTakeFirst();

    if (!gameRules) {
      throw new NotFoundException('Game rules were not found for this season');
    }

    return toLeagueSeasonResponse(leagueSeason, gameRules);
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

    return this.db.transaction().execute(async (trx) => {
      const updatedSeason = await trx
        .updateTable('admin.league_seasons')
        .set({
          ...(updateLeagueSeasonDto.competitionDefaults
            ? toCompetitionValues(
                updateLeagueSeasonDto.competitionDefaults,
                updateLeagueSeasonDto.scheduleSlotDurationMinutes ??
                  leagueSeason.schedule_slot_duration_minutes,
              )
            : {
                schedule_slot_duration_minutes:
                  updateLeagueSeasonDto.scheduleSlotDurationMinutes,
              }),
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

      const updatedRules = updateLeagueSeasonDto.gameRules
        ? await trx
            .updateTable('admin.league_season_game_rules')
            .set({
              ...toGameRulesValues(updateLeagueSeasonDto.gameRules),
              updated_at: new Date(),
            })
            .where('league_season_id', '=', leagueSeasonId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await trx
            .selectFrom('admin.league_season_game_rules')
            .selectAll()
            .where('league_season_id', '=', leagueSeasonId)
            .executeTakeFirstOrThrow();

      return toLeagueSeasonResponse(updatedSeason, updatedRules);
    });
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
