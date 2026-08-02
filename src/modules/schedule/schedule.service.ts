import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_ROLES,
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import type { FinalizeScheduleGameDto } from './dto/finalize-schedule-game.dto';
import type { ScheduleListQueryDto } from './dto/schedule-list-query.dto';
import type { UpdateScorekeeperAssignmentDto } from './dto/update-scorekeeper-assignment.dto';
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

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
  ) {
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

    if (createScheduleDto.scorekeeperMemberId) {
      await this.assertScorekeeperCanBeAssigned(
        this.db,
        organizationId,
        createScheduleDto.scorekeeperMemberId,
      );
    }

    const inserted = await (this.db as any)
      .transaction()
      .execute(async (trx) => {
        const game = await trx
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

        if (createScheduleDto.scorekeeperMemberId) {
          await this.replaceScorekeeperAssignmentInTransaction(
            trx,
            game.id,
            createScheduleDto.scorekeeperMemberId,
          );

          await this.writeAuditInTransaction(
            trx,
            access,
            'game.scorekeeper_assigned',
            game.id,
            {
              previousScorekeeperMemberId: null,
              scorekeeperMemberId: createScheduleDto.scorekeeperMemberId,
            },
          );
        }

        return game;
      });

    return this.findOne(organizationId, inserted.id);
  }

  findEligibleScorekeepers(organizationId: string) {
    return this.db
      .selectFrom('admin.organization_members as members')
      .innerJoin('auth.users as users', 'users.id', 'members.user_id')
      .select(['members.id', 'users.name', 'users.email'])
      .where('members.organization_id', '=', organizationId)
      .where('members.role', '=', AUTH_ROLES.SCOREKEEPER)
      .where('members.status', '=', 'active')
      .orderBy('users.name asc')
      .orderBy('users.email asc')
      .execute();
  }

  findAll(
    organizationId: string,
    accessOrQuery: OrganizationAccessContext | ScheduleListQueryDto,
    maybeQuery: ScheduleListQueryDto = {},
  ) {
    const access = this.resolveAccessContext(accessOrQuery);
    const query = this.resolveQuery(accessOrQuery, maybeQuery);
    let dataQuery = (this.db as any)
      .selectFrom('admin.schedule_games')
      .selectAll()
      .where('organization_id', '=', organizationId);

    dataQuery = this.applyGameReadScope(dataQuery, access);

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

  async findOne(
    organizationId: string,
    gameId: string,
    access?: OrganizationAccessContext,
  ) {
    let gameQuery = (this.db as any)
      .selectFrom('admin.schedule_games')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', gameId);

    if (access) {
      gameQuery = this.applyGameReadScope(gameQuery, access);
    }

    const game = await gameQuery.executeTakeFirst();

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
    this.assertGameIsNotFinal(existingGame.status);

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
    await this.assertScoringDomainDoesNotOwnResult(gameId, updateScheduleDto);

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
    const existingGame = await this.findGameRecord(organizationId, gameId);
    this.assertGameCanBeDeleted(existingGame.status);

    await this.db
      .deleteFrom('competition.games')
      .where('id', '=', gameId)
      .execute();

    return { success: true };
  }

  async finalizeManually(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    finalizeScheduleGameDto: FinalizeScheduleGameDto,
  ) {
    const existingGame = await this.findGameRecord(organizationId, gameId);

    this.assertManualFinalizationIsOpen(existingGame.status);
    this.assertManualFinalScore(finalizeScheduleGameDto);
    await this.assertGameHasNoScoringActivity(gameId);

    const finalizedAt = new Date();

    await (this.db as any).transaction().execute(async (trx) => {
      await trx
        .updateTable('competition.games')
        .set({
          away_score: finalizeScheduleGameDto.awayScore,
          finalized_at: finalizedAt,
          home_score: finalizeScheduleGameDto.homeScore,
          status: 'final',
          updated_at: finalizedAt,
        })
        .where('id', '=', gameId)
        .executeTakeFirstOrThrow();

      await this.writeAuditInTransaction(
        trx,
        access,
        'game.manually_finalized',
        gameId,
        {
          previousStatus: existingGame.status,
          homeScore: finalizeScheduleGameDto.homeScore,
          awayScore: finalizeScheduleGameDto.awayScore,
        },
      );
    });

    return this.findOne(organizationId, gameId);
  }

  async updateScorekeeperAssignment(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    updateScorekeeperAssignmentDto: UpdateScorekeeperAssignmentDto,
  ) {
    const existingGame = await this.findGameRecord(organizationId, gameId);

    this.assertScorekeeperAssignmentIsOpen(existingGame.status);

    const nextScorekeeperMemberId =
      updateScorekeeperAssignmentDto.scorekeeperMemberId;

    if (nextScorekeeperMemberId) {
      await this.assertScorekeeperCanBeAssigned(
        this.db,
        organizationId,
        nextScorekeeperMemberId,
      );
    }

    const previousAssignment = await this.db
      .selectFrom('access.game_scorekeeper_assignments')
      .select(['organization_member_id'])
      .where('game_id', '=', gameId)
      .executeTakeFirst();

    await (this.db as any).transaction().execute(async (trx) => {
      await this.replaceScorekeeperAssignmentInTransaction(
        trx,
        gameId,
        nextScorekeeperMemberId,
      );

      await this.writeAuditInTransaction(
        trx,
        access,
        'game.scorekeeper_assignment.updated',
        gameId,
        {
          previousScorekeeperMemberId:
            previousAssignment?.organization_member_id ?? null,
          scorekeeperMemberId: nextScorekeeperMemberId ?? null,
        },
      );
    });

    return this.findOne(organizationId, gameId);
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

  private assertScorekeeperAssignmentIsOpen(status: string): void {
    if (['draft', 'scheduled', 'postponed'].includes(status)) {
      return;
    }

    throw new BadRequestException(
      'Scorekeeper assignments lock after the game begins. Reopen this only before game day action starts.',
    );
  }

  private assertGameIsNotFinal(status: string): void {
    if (status !== 'final') {
      return;
    }

    throw new BadRequestException(
      'This game is final and can no longer be edited.',
    );
  }

  private assertGameCanBeDeleted(status: string): void {
    if (status !== 'final') {
      return;
    }

    throw new BadRequestException(
      'Finalized games cannot be deleted because they are part of the official league record.',
    );
  }

  private assertManualFinalizationIsOpen(status: string): void {
    if (status === 'scheduled') {
      return;
    }

    throw new BadRequestException(
      'Only scheduled games can be finalized from Schedules.',
    );
  }

  private assertManualFinalScore(
    finalizeScheduleGameDto: FinalizeScheduleGameDto,
  ): void {
    const { awayScore, homeScore } = finalizeScheduleGameDto;

    if (
      !Number.isInteger(homeScore) ||
      !Number.isInteger(awayScore) ||
      homeScore < 0 ||
      awayScore < 0
    ) {
      throw new BadRequestException(
        'Enter valid whole-number scores for both teams.',
      );
    }

    if (homeScore === awayScore) {
      throw new BadRequestException(
        'Basketball games need a winning team before they can be finalized.',
      );
    }
  }

  private async assertGameHasNoScoringActivity(gameId: string): Promise<void> {
    const scoringState = await this.db
      .selectFrom('scoring.game_states')
      .select(['game_id'])
      .where('game_id', '=', gameId)
      .executeTakeFirst();

    if (scoringState) {
      throw new BadRequestException(
        'This game already has scoring activity. Use the scorekeeper console to finish it.',
      );
    }
  }

  private async assertScorekeeperCanBeAssigned(
    db: Database | any,
    organizationId: string,
    scorekeeperMemberId: string,
  ): Promise<void> {
    const scorekeeper = await db
      .selectFrom('admin.organization_members')
      .select(['id'])
      .where('id', '=', scorekeeperMemberId)
      .where('organization_id', '=', organizationId)
      .where('role', '=', AUTH_ROLES.SCOREKEEPER)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!scorekeeper) {
      throw new BadRequestException(
        'Choose an active scorekeeper from this organization.',
      );
    }
  }

  private async replaceScorekeeperAssignmentInTransaction(
    trx: any,
    gameId: string,
    scorekeeperMemberId: string | null | undefined,
  ): Promise<void> {
    await trx
      .deleteFrom('access.game_scorekeeper_assignments')
      .where('game_id', '=', gameId)
      .execute();

    if (!scorekeeperMemberId) {
      return;
    }

    await trx
      .insertInto('access.game_scorekeeper_assignments')
      .values({
        game_id: gameId,
        organization_member_id: scorekeeperMemberId,
      })
      .execute();
  }

  private async writeAuditInTransaction(
    trx: any,
    access: OrganizationAccessContext,
    action: string,
    gameId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await trx
      .insertInto('access.audit_events')
      .values({
        action,
        actor_member_id: access.membershipId,
        metadata,
        organization_id: access.organizationId,
        target_id: gameId,
        target_type: 'game',
      })
      .execute();
  }

  private applyGameReadScope(query: any, access?: OrganizationAccessContext) {
    if (!access) {
      return query;
    }

    if (access.permissions.includes(ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE)) {
      return query;
    }

    if (
      access.permissions.includes(ORGANIZATION_PERMISSIONS.TEAMS_READ_ASSIGNED)
    ) {
      return query.where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('access.team_manager_assignments as assigned_teams')
              .select('assigned_teams.id')
              .where(
                'assigned_teams.organization_member_id',
                '=',
                access.membershipId,
              )
              .whereRef(
                'assigned_teams.team_id',
                '=',
                'admin.schedule_games.home_team_id',
              ),
          ),
          eb.exists(
            eb
              .selectFrom('access.team_manager_assignments as assigned_teams')
              .select('assigned_teams.id')
              .where(
                'assigned_teams.organization_member_id',
                '=',
                access.membershipId,
              )
              .whereRef(
                'assigned_teams.team_id',
                '=',
                'admin.schedule_games.away_team_id',
              ),
          ),
        ]),
      );
    }

    return query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('access.game_scorekeeper_assignments as assigned_games')
          .select('assigned_games.id')
          .where(
            'assigned_games.organization_member_id',
            '=',
            access.membershipId,
          )
          .whereRef('assigned_games.game_id', '=', 'admin.schedule_games.id'),
      ),
    );
  }

  private resolveAccessContext(
    input: OrganizationAccessContext | ScheduleListQueryDto,
  ): OrganizationAccessContext | undefined {
    if ('membershipId' in input) {
      return input;
    }

    return undefined;
  }

  private async assertScoringDomainDoesNotOwnResult(
    gameId: string,
    updateScheduleDto: UpdateScheduleDto,
  ): Promise<void> {
    const touchesScoringState =
      updateScheduleDto.awayScore !== undefined ||
      updateScheduleDto.homeScore !== undefined ||
      ['final', 'live', 'reopened'].includes(updateScheduleDto.status ?? '');

    if (!touchesScoringState) {
      return;
    }

    const scoringState = await this.db
      .selectFrom('scoring.game_states')
      .select(['game_id'])
      .where('game_id', '=', gameId)
      .executeTakeFirst();

    if (scoringState) {
      throw new BadRequestException(
        'Scoring state exists; use scoring endpoints for live and official result changes',
      );
    }
  }

  private resolveQuery(
    input: OrganizationAccessContext | ScheduleListQueryDto,
    query: ScheduleListQueryDto,
  ): ScheduleListQueryDto {
    if ('membershipId' in input) {
      return query;
    }

    return input;
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
