import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
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
import { NotificationWriter } from '../notification/notification.writer';
import type { NotificationEventType } from '../notification/notification.events';
import { findScheduleConflict } from './schedule-conflicts';
import type { UpdateStatisticianAssignmentDto } from './dto/update-statistician-assignment.dto';
import { OfficialResultCoordinator } from '../official-result/official-result.service';

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
  matchup_id: string | null;
  competition_kind: string;
};

type CompetitionScheduleInput = CreateScheduleDto & {
  matchupId: string;
  competitionKind: 'stage' | 'playoff';
};

@Injectable()
export class ScheduleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Optional() private readonly notificationWriter?: NotificationWriter,
    @Optional()
    private readonly officialResultCoordinator?: OfficialResultCoordinator,
  ) {}

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
  ) {
    if (createScheduleDto.status && !['draft', 'scheduled'].includes(createScheduleDto.status)) {
      throw new BadRequestException('New games can only be drafts or scheduled games.');
    }
    return this.createGame(organizationId, access, createScheduleDto, {
      competitionKind: 'exhibition',
      matchupId: null,
    });
  }

  async createCompetitionGame(
    organizationId: string,
    access: OrganizationAccessContext,
    input: CompetitionScheduleInput,
  ) {
    return this.createGame(organizationId, access, input, {
      competitionKind: input.competitionKind,
      matchupId: input.matchupId,
    });
  }

  private async createGame(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
    competition: { competitionKind: 'stage' | 'playoff' | 'exhibition'; matchupId: string | null },
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
    if (createScheduleDto.statisticianMemberId) {
      await this.assertStatisticianCanBeAssigned(
        organizationId,
        createScheduleDto.statisticianMemberId,
      );
    }

    if (createScheduleDto.status === 'scheduled') {
      await this.assertNoScheduleConflict({
        awayTeamId: createScheduleDto.awayTeamId,
        homeTeamId: createScheduleDto.homeTeamId,
        leagueSeasonId: createScheduleDto.leagueSeasonId,
        startsAt: new Date(createScheduleDto.startsAt),
        venueId: createScheduleDto.venueId,
      });
    }

    const inserted = await (this.db as any)
      .transaction()
      .execute(async (trx) => {
        const game = await trx
          .insertInto('competition.games')
          .values({
            away_team_id: createScheduleDto.awayTeamId,
            away_score: null,
            competition_kind: competition.competitionKind,
            division_id: createScheduleDto.divisionId,
            finalized_at: null,
            home_score: null,
            home_team_id: createScheduleDto.homeTeamId,
            league_season_id: createScheduleDto.leagueSeasonId,
            matchup_id: competition.matchupId,
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

        if (createScheduleDto.statisticianMemberId) {
          await trx
            .insertInto('access.game_statistician_assignments')
            .values({
              game_id: game.id,
              organization_member_id: createScheduleDto.statisticianMemberId,
            })
            .execute();
          await this.writeAuditInTransaction(
            trx,
            access,
            'game.statistician_assignment.updated',
            game.id,
            {
              previousStatisticianMemberId: null,
              statisticianMemberId: createScheduleDto.statisticianMemberId,
            },
          );
        }

        return game;
      });

    const game = await this.findOne(organizationId, inserted.id);
    if (createScheduleDto.status === 'scheduled') {
      await this.notifyGameRecipients(
        organizationId,
        inserted.id,
        access,
        'schedule.game_published',
      );
    }
    if (createScheduleDto.scorekeeperMemberId) {
      await this.notifyScorekeeperAssignment(
        organizationId,
        inserted.id,
        access,
        createScheduleDto.scorekeeperMemberId,
        'schedule.scorekeeper_assigned',
      );
    }
    return game;
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

  findEligibleStatisticians(organizationId: string) {
    return this.db
      .selectFrom('admin.organization_members as members')
      .innerJoin('auth.users as users', 'users.id', 'members.user_id')
      .select(['members.id', 'users.name', 'users.email'])
      .where('members.organization_id', '=', organizationId)
      .where('members.role', '=', AUTH_ROLES.STATISTICIAN)
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

    if (query.leagueSeasonId) {
      dataQuery = dataQuery.where(
        'league_season_id',
        '=',
        query.leagueSeasonId,
      );
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
    const incomingStatus = (updateScheduleDto as { status?: string }).status;
    if (
      incomingStatus !== undefined &&
      !['draft', 'scheduled', 'postponed', 'cancelled'].includes(incomingStatus) &&
      incomingStatus !== 'final'
    ) {
      throw new BadRequestException(
        'Only draft, scheduled, postponed, or cancelled games can be changed here.',
      );
    }
    await this.assertGenericUpdateIsAllowed(existingGame, gameId);
    this.assertGameIsNotFinal(existingGame.status);
    if ((updateScheduleDto as { status?: string }).status === 'final') {
      throw new BadRequestException(
        'Use Finalize game to record an official result and update standings.',
      );
    }

    await this.assertScheduleRelations(organizationId, {
      awayTeamId: existingGame.away_team_id,
      divisionId: existingGame.division_id,
      homeTeamId: existingGame.home_team_id,
      leagueSeasonId: existingGame.league_season_id,
      venueId: updateScheduleDto.venueId ?? existingGame.venue_id,
    });

    const nextStartsAt = updateScheduleDto.startsAt
      ? new Date(updateScheduleDto.startsAt)
      : existingGame.starts_at;
    const nextStatus = updateScheduleDto.status ?? existingGame.status;
    if (nextStatus === 'scheduled') {
      await this.assertNoScheduleConflict({
        awayTeamId: existingGame.away_team_id,
        excludedGameId: gameId,
        homeTeamId: existingGame.home_team_id,
        leagueSeasonId: existingGame.league_season_id,
        startsAt: nextStartsAt,
        venueId: updateScheduleDto.venueId ?? existingGame.venue_id,
      });
    }

    await this.db
      .updateTable('competition.games')
      .set({
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

    const updatedGame = await this.findOne(organizationId, gameId);
    if (updateScheduleDto.status === 'postponed') {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_postponed',
      );
    } else if (updateScheduleDto.status === 'scheduled' && !existingGame.published_at) {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_published',
      );
    } else if (
      updateScheduleDto.startsAt || updateScheduleDto.venueId
    ) {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_changed',
      );
    }

    return updatedGame;
  }

  async remove(organizationId: string, gameId: string) {
    throw new ConflictException(
      'This record cannot be deleted. Archive support is being prepared so league history remains available.',
    );

    const existingGame = await this.findGameRecord(organizationId, gameId);
    this.assertGameCanBeDeleted(existingGame.status);

    if (existingGame.published_at) {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_removed',
      );
    }

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

    if (!this.officialResultCoordinator) {
      throw new Error('Official result coordinator is unavailable');
    }
    await this.officialResultCoordinator.finalize({
      access,
      awayScore: finalizeScheduleGameDto.awayScore,
      gameId,
      homeScore: finalizeScheduleGameDto.homeScore,
      organizationId,
      source: 'manual',
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

    if (previousAssignment?.organization_member_id) {
      await this.notifyScorekeeperAssignment(
        organizationId,
        gameId,
        access,
        previousAssignment.organization_member_id,
        'schedule.scorekeeper_unassigned',
      );
    }
    if (nextScorekeeperMemberId) {
      await this.notifyScorekeeperAssignment(
        organizationId,
        gameId,
        access,
        nextScorekeeperMemberId,
        'schedule.scorekeeper_assigned',
      );
    }

    return this.findOne(organizationId, gameId);
  }

  async updateStatisticianAssignment(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: UpdateStatisticianAssignmentDto,
  ) {
    const existingGame = await this.findGameRecord(organizationId, gameId);
    this.assertScorekeeperAssignmentIsOpen(existingGame.status);
    const statisticianMemberId = dto.statisticianMemberId;

    if (statisticianMemberId) {
      await this.assertStatisticianCanBeAssigned(
        organizationId,
        statisticianMemberId,
      );
    }

    const previous = await this.db
      .selectFrom('access.game_statistician_assignments')
      .select('organization_member_id')
      .where('game_id', '=', gameId)
      .executeTakeFirst();

    await (this.db as any).transaction().execute(async (trx) => {
      await trx
        .deleteFrom('access.game_statistician_assignments')
        .where('game_id', '=', gameId)
        .execute();
      if (statisticianMemberId) {
        await trx
          .insertInto('access.game_statistician_assignments')
          .values({
            game_id: gameId,
            organization_member_id: statisticianMemberId,
          })
          .execute();
      }
      await this.writeAuditInTransaction(
        trx,
        access,
        'game.statistician_assignment.updated',
        gameId,
        {
          previousStatisticianMemberId:
            previous?.organization_member_id ?? null,
          statisticianMemberId: statisticianMemberId ?? null,
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

  private async findGameNotificationContext(
    organizationId: string,
    gameId: string,
  ) {
    const row = await (this.db as any)
      .selectFrom('admin.schedule_games')
      .select([
        'away_team_name',
        'home_team_name',
        'starts_at',
        'status',
        'venue_name',
      ])
      .where('organization_id', '=', organizationId)
      .where('id', '=', gameId)
      .executeTakeFirst();
    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['name', 'slug'])
      .where('id', '=', organizationId)
      .executeTakeFirstOrThrow();

    if (!row) {
      throw new NotFoundException('Schedule game not found');
    }

    return {
      gameLabel: `${row.home_team_name ?? 'Home'} vs ${row.away_team_name ?? 'Away'}`,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      reminderLabel: row.starts_at
        ? new Date(row.starts_at).toLocaleString()
        : undefined,
      startsAt: row.starts_at,
      venueName: row.venue_name,
    };
  }

  private async findGameRecipients(gameId: string) {
    const game = await (this.db as any)
      .selectFrom('competition.games')
      .select(['home_team_id', 'away_team_id'])
      .where('id', '=', gameId)
      .executeTakeFirst();

    if (!game) {
      return [];
    }

    const managers = await (this.db as any)
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.team_id', 'in', [
        game.home_team_id,
        game.away_team_id,
      ])
      .where('members.status', '=', 'active')
      .execute();
    const scorekeepers = await (this.db as any)
      .selectFrom('access.game_scorekeeper_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.game_id', '=', gameId)
      .where('members.status', '=', 'active')
      .execute();

    return [
      ...managers.map((row: { user_id: string }) => ({ userId: row.user_id })),
      ...scorekeepers.map((row: { user_id: string }) => ({
        userId: row.user_id,
      })),
    ];
  }

  private async notifyGameRecipients(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext | undefined,
    eventType: Extract<
      NotificationEventType,
      | 'schedule.game_published'
      | 'schedule.game_changed'
      | 'schedule.game_postponed'
      | 'schedule.game_removed'
      | 'scoring.game_finalized'
    >,
    extra: { resultLabel?: string } = {},
  ) {
    if (!this.notificationWriter) {
      return;
    }

    const [context, recipients] = await Promise.all([
      this.findGameNotificationContext(organizationId, gameId),
      this.findGameRecipients(gameId),
    ]);

    await this.notificationWriter.create({
      actorUserId: access?.userId,
      context: {
        ...context,
        gameId,
        resultLabel: extra.resultLabel,
      },
      dedupeKey: `game:${gameId}:${eventType}:${new Date().toISOString()}`,
      eventType,
      organizationId,
      recipients,
      resourceId: gameId,
      resourceType: 'game',
    });
  }

  private async notifyScorekeeperAssignment(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    memberId: string,
    eventType: Extract<
      NotificationEventType,
      'schedule.scorekeeper_assigned' | 'schedule.scorekeeper_unassigned'
    >,
  ) {
    if (!this.notificationWriter) {
      return;
    }

    const [context, member] = await Promise.all([
      this.findGameNotificationContext(organizationId, gameId),
      (this.db as any)
        .selectFrom('admin.organization_members')
        .select(['user_id'])
        .where('id', '=', memberId)
        .where('status', '=', 'active')
        .executeTakeFirst(),
    ]);

    if (!member) {
      return;
    }

    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: { ...context, gameId },
      dedupeKey: `game:${gameId}:scorekeeper:${memberId}:${eventType}:${new Date().toISOString()}`,
      eventType,
      organizationId,
      recipients: [{ userId: member.user_id }],
      resourceId: gameId,
      resourceType: 'game',
    });
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

  private async assertNoScheduleConflict(params: {
    awayTeamId: string;
    excludedGameId?: string;
    homeTeamId: string;
    leagueSeasonId: string;
    startsAt: Date;
    venueId: string;
  }): Promise<void> {
    const [season, games] = await Promise.all([
      this.db
        .selectFrom('admin.league_seasons')
        .select('schedule_slot_duration_minutes')
        .where('id', '=', params.leagueSeasonId)
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('competition.games')
        .select([
          'away_team_id',
          'home_team_id',
          'id',
          'starts_at',
          'venue_id',
        ])
        .where('league_season_id', '=', params.leagueSeasonId)
        .where('status', 'in', ['scheduled', 'live', 'reopened'])
        .execute(),
    ]);
    const conflict = findScheduleConflict(
      {
        awayTeamId: params.awayTeamId,
        homeTeamId: params.homeTeamId,
        startsAt: params.startsAt,
        venueId: params.venueId,
      },
      season.schedule_slot_duration_minutes,
      games.map((game) => ({
        awayTeamId: game.away_team_id,
        homeTeamId: game.home_team_id,
        id: game.id,
        startsAt: new Date(game.starts_at),
        venueId: game.venue_id,
      })),
      params.excludedGameId,
    );

    if (!conflict) return;
    if (conflict.kind === 'team') {
      throw new ConflictException(
        'One of these teams already has a game during the selected time slot.',
      );
    }
    throw new ConflictException(
      'This venue is already booked during the selected time slot.',
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
        'games.matchup_id',
        'games.competition_kind',
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

  private async assertGenericUpdateIsAllowed(
    game: ScheduleGameRecord,
    gameId: string,
  ): Promise<void> {
    if (
      ['live', 'final', 'reopened'].includes(game.status) ||
      game.away_score !== null ||
      game.home_score !== null ||
      game.finalized_at !== null ||
      game.matchup_id !== null ||
      game.competition_kind !== 'exhibition'
    ) {
      throw new ConflictException(
        'Use the competition or scoring workflow to change this game.',
      );
    }

    const scoringState = await this.db
      .selectFrom('scoring.game_states')
      .select(['game_id'])
      .where('game_id', '=', gameId)
      .executeTakeFirst();
    if (scoringState) {
      throw new ConflictException(
        'Use the competition or scoring workflow to change this game.',
      );
    }
  }

  private async assertStatisticianCanBeAssigned(
    organizationId: string,
    statisticianMemberId: string,
  ): Promise<void> {
    const statistician = await this.db
      .selectFrom('admin.organization_members')
      .select('id')
      .where('id', '=', statisticianMemberId)
      .where('organization_id', '=', organizationId)
      .where('role', '=', AUTH_ROLES.STATISTICIAN)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!statistician) {
      throw new BadRequestException(
        'Choose an active statistician from this organization.',
      );
    }
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

    const assignmentTable = access.permissions.includes(
      ORGANIZATION_PERMISSIONS.GAME_STATS_ASSIGNED,
    )
      ? 'access.game_statistician_assignments as assigned_games'
      : 'access.game_scorekeeper_assignments as assigned_games';

    return query.where((eb) =>
      eb.exists(
        eb
          .selectFrom(assignmentTable)
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

}
