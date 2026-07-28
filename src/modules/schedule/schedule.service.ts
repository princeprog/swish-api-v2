import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import type { ScheduleListQueryDto } from './dto/schedule-list-query.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

type ScheduleGameRecord = {
  away_score: number | null;
  away_team_id: string;
  created_at: Date;
  division_id: string;
  finalized_at: Date | null;
  home_score: number | null;
  home_team_id: string;
  id: string;
  league_season_id: string;
  published_at: Date | null;
  starts_at: Date;
  status: string;
  updated_at: Date;
  venue_id: string;
};

@Injectable()
export class ScheduleService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createScheduleDto: CreateScheduleDto) {
    this.assertDistinctTeams(
      createScheduleDto.homeTeamId,
      createScheduleDto.awayTeamId,
    );

    await this.assertScheduleRelations(organizationId, {
      awayTeamId: createScheduleDto.awayTeamId,
      divisionId: createScheduleDto.divisionId,
      homeTeamId: createScheduleDto.homeTeamId,
      leagueSeasonId: createScheduleDto.leagueSeasonId,
      venueId: createScheduleDto.venueId,
    });

    const inserted = await this.db
      .insertInto('competition.games')
      .values({
        away_team_id: createScheduleDto.awayTeamId,
        away_score: createScheduleDto.awayScore,
        division_id: createScheduleDto.divisionId,
        finalized_at: this.resolveCreatedFinalizedAt(createScheduleDto),
        home_score: createScheduleDto.homeScore,
        home_team_id: createScheduleDto.homeTeamId,
        league_season_id: createScheduleDto.leagueSeasonId,
        published_at:
          createScheduleDto.status === 'scheduled' ? new Date() : null,
        starts_at: new Date(createScheduleDto.startsAt),
        status: createScheduleDto.status ?? 'draft',
        venue_id: createScheduleDto.venueId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return this.findOne(organizationId, inserted.id);
  }

  findAll(organizationId: string, query: ScheduleListQueryDto = {}) {
    let dataQuery = (this.db as any)
      .selectFrom('admin.schedule_games')
      .selectAll()
      .where('organization_id', '=', organizationId);

    if (query.search) {
      const search = `%${query.search}%`;
      dataQuery = dataQuery.where((eb) =>
        eb.or([
          eb('home_team_name', 'ilike', search),
          eb('away_team_name', 'ilike', search),
          eb('venue_name', 'ilike', search),
          eb('division_name', 'ilike', search),
          eb('league_season_name', 'ilike', search),
        ]),
      );
    }

    if (query.divisionId) {
      dataQuery = dataQuery.where('division_id', '=', query.divisionId);
    }

    if (query.status) {
      dataQuery = dataQuery.where('status', '=', query.status);
    }

    if (query.sortBy === 'division') {
      dataQuery = dataQuery
        .orderBy('division_name asc')
        .orderBy('starts_at asc');
    } else if (query.sortBy === 'venue') {
      dataQuery = dataQuery.orderBy('venue_name asc').orderBy('starts_at asc');
    } else {
      dataQuery = dataQuery.orderBy('starts_at asc');
    }

    return dataQuery.execute();
  }

  async findOne(organizationId: string, gameId: string) {
    const game = await (this.db as any)
      .selectFrom('admin.schedule_games')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', gameId)
      .executeTakeFirst();

    if (!game) {
      throw new NotFoundException('Schedule game not found');
    }

    return game;
  }

  async update(
    organizationId: string,
    gameId: string,
    updateScheduleDto: UpdateScheduleDto,
  ) {
    const existingGame = await this.findGameRecord(organizationId, gameId);
    const nextLeagueSeasonId =
      updateScheduleDto.leagueSeasonId ?? existingGame.league_season_id;
    const nextDivisionId =
      updateScheduleDto.divisionId ?? existingGame.division_id;
    const nextVenueId = updateScheduleDto.venueId ?? existingGame.venue_id;
    const nextHomeTeamId =
      updateScheduleDto.homeTeamId ?? existingGame.home_team_id;
    const nextAwayTeamId =
      updateScheduleDto.awayTeamId ?? existingGame.away_team_id;

    this.assertDistinctTeams(nextHomeTeamId, nextAwayTeamId);
    this.assertFinalScoreState(existingGame, updateScheduleDto);

    await this.assertScheduleRelations(organizationId, {
      awayTeamId: nextAwayTeamId,
      divisionId: nextDivisionId,
      homeTeamId: nextHomeTeamId,
      leagueSeasonId: nextLeagueSeasonId,
      venueId: nextVenueId,
    });

    await this.db
      .updateTable('competition.games')
      .set({
        away_team_id: updateScheduleDto.awayTeamId,
        away_score: updateScheduleDto.awayScore,
        division_id: updateScheduleDto.divisionId,
        finalized_at: this.resolveFinalizedAt(existingGame, updateScheduleDto),
        home_score: updateScheduleDto.homeScore,
        home_team_id: updateScheduleDto.homeTeamId,
        league_season_id: updateScheduleDto.leagueSeasonId,
        published_at: this.resolvePublishedAt(existingGame, updateScheduleDto),
        starts_at: updateScheduleDto.startsAt
          ? new Date(updateScheduleDto.startsAt)
          : undefined,
        status: updateScheduleDto.status,
        updated_at: new Date(),
        venue_id: updateScheduleDto.venueId,
      })
      .where('id', '=', gameId)
      .executeTakeFirstOrThrow();

    return this.findOne(organizationId, gameId);
  }

  async remove(organizationId: string, gameId: string) {
    await this.findGameRecord(organizationId, gameId);

    await this.db
      .deleteFrom('competition.games')
      .where('id', '=', gameId)
      .execute();

    return { success: true };
  }

  private assertDistinctTeams(homeTeamId: string, awayTeamId: string): void {
    if (homeTeamId === awayTeamId) {
      throw new BadRequestException('Home and away teams must be different');
    }
  }

  private async assertScheduleRelations(
    organizationId: string,
    params: {
      awayTeamId: string;
      divisionId: string;
      homeTeamId: string;
      leagueSeasonId: string;
      venueId: string;
    },
  ): Promise<void> {
    await this.assertLeagueSeasonBelongsToOrganization(
      organizationId,
      params.leagueSeasonId,
    );
    await this.assertDivisionBelongsToLeagueSeason(
      params.divisionId,
      params.leagueSeasonId,
    );
    await this.assertVenueBelongsToLeagueSeason(
      params.venueId,
      params.leagueSeasonId,
    );
    await this.assertTeamBelongsToDivision(
      params.homeTeamId,
      params.divisionId,
    );
    await this.assertTeamBelongsToDivision(
      params.awayTeamId,
      params.divisionId,
    );
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

  private async assertDivisionBelongsToLeagueSeason(
    divisionId: string,
    leagueSeasonId: string,
  ): Promise<void> {
    const division = await this.db
      .selectFrom('admin.divisions')
      .select(['id'])
      .where('id', '=', divisionId)
      .where('league_season_id', '=', leagueSeasonId)
      .executeTakeFirst();

    if (!division) {
      throw new NotFoundException('Division not found in this league season');
    }
  }

  private async assertVenueBelongsToLeagueSeason(
    venueId: string,
    leagueSeasonId: string,
  ): Promise<void> {
    const venue = await this.db
      .selectFrom('admin.venues')
      .select(['id'])
      .where('id', '=', venueId)
      .where('league_season_id', '=', leagueSeasonId)
      .executeTakeFirst();

    if (!venue) {
      throw new NotFoundException('Venue not found in this league season');
    }
  }

  private async assertTeamBelongsToDivision(
    teamId: string,
    divisionId: string,
  ): Promise<void> {
    const team = await this.db
      .selectFrom('admin.teams')
      .select(['id'])
      .where('id', '=', teamId)
      .where('division_id', '=', divisionId)
      .executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found in this division');
    }
  }

  private async findGameRecord(
    organizationId: string,
    gameId: string,
  ): Promise<ScheduleGameRecord> {
    const game = await this.db
      .selectFrom('competition.games as games')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'games.league_season_id',
      )
      .select([
        'games.away_team_id',
        'games.away_score',
        'games.created_at',
        'games.division_id',
        'games.finalized_at',
        'games.home_score',
        'games.home_team_id',
        'games.id',
        'games.league_season_id',
        'games.published_at',
        'games.starts_at',
        'games.status',
        'games.updated_at',
        'games.venue_id',
      ])
      .where('games.id', '=', gameId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!game) {
      throw new NotFoundException('Schedule game not found');
    }

    return game;
  }

  private resolvePublishedAt(
    existingGame: ScheduleGameRecord,
    updateScheduleDto: UpdateScheduleDto,
  ): Date | null | undefined {
    if (!updateScheduleDto.status) {
      return undefined;
    }

    if (existingGame.published_at && updateScheduleDto.status !== 'draft') {
      return existingGame.published_at;
    }

    if (updateScheduleDto.status === 'scheduled') {
      return new Date();
    }

    if (updateScheduleDto.status === 'draft') {
      return null;
    }

    return existingGame.published_at;
  }

  private resolveCreatedFinalizedAt(
    createScheduleDto: CreateScheduleDto,
  ): Date | null {
    if (createScheduleDto.status !== 'final') {
      return null;
    }

    if (
      createScheduleDto.homeScore === undefined ||
      createScheduleDto.awayScore === undefined
    ) {
      throw new BadRequestException('Final games require home and away scores');
    }

    return new Date();
  }

  private assertFinalScoreState(
    existingGame: ScheduleGameRecord,
    updateScheduleDto: UpdateScheduleDto,
  ): void {
    const nextStatus = updateScheduleDto.status ?? existingGame.status;

    if (nextStatus !== 'final') {
      return;
    }

    const homeScore = updateScheduleDto.homeScore ?? existingGame.home_score;
    const awayScore = updateScheduleDto.awayScore ?? existingGame.away_score;

    if (
      homeScore === null ||
      homeScore === undefined ||
      awayScore === null ||
      awayScore === undefined
    ) {
      throw new BadRequestException('Final games require home and away scores');
    }
  }

  private resolveFinalizedAt(
    existingGame: ScheduleGameRecord,
    updateScheduleDto: UpdateScheduleDto,
  ): Date | null | undefined {
    if (!updateScheduleDto.status) {
      return undefined;
    }

    if (updateScheduleDto.status === 'final') {
      return existingGame.finalized_at ?? new Date();
    }

    if (existingGame.status === 'final') {
      return null;
    }

    return existingGame.finalized_at;
  }
}
