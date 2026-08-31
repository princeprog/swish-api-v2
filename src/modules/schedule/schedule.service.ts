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

  /**
   * The season row is the canonical mutex for every schedule mutation. Callers
   * that already own a transaction must acquire this lock before locking a
   * generated matchup, game, or assignment row.
   */
  async lockSeasonForScheduling(
    trx: any,
    organizationId: string,
    leagueSeasonId: string,
  ) {
    let query = trx
      .selectFrom('admin.league_seasons')
      .select(['id', 'schedule_slot_duration_minutes'])
      .where('id', '=', leagueSeasonId)
      .where('organization_id', '=', organizationId);
    if (typeof query.forUpdate === 'function') query = query.forUpdate();
    const season = await query.executeTakeFirst();
    if (!season) {
      throw new NotFoundException(
        'League season not found in this organization',
      );
    }
    return season;
  }

  private async lockGameForScheduling(trx: any, gameId: string) {
    let query = trx
      .selectFrom('competition.games')
      .select(['id'])
      .where('id', '=', gameId);
    if (typeof query.forUpdate === 'function') query = query.forUpdate();
    return query.executeTakeFirst();
  }

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
  ) {
    if (
      createScheduleDto.status &&
      !['draft', 'scheduled'].includes(createScheduleDto.status)
    ) {
      throw new BadRequestException(
        'New games can only be drafts or scheduled games.',
      );
    }
    return this.createGame(organizationId, access, createScheduleDto, {
      competitionKind: 'exhibition',
      matchupId: null,
    });
  }

  /**
   * Materialize a generated matchup using a caller-owned transaction. The
   * competition service owns the parent format/matchup locks and performs the
   * status transition in this same transaction.
   */
  async createCompetitionGameInTransaction(
    organizationId: string,
    access: OrganizationAccessContext,
    input: CompetitionScheduleInput,
    trx: any,
  ) {
    await this.assertCompetitionGameIdentity(organizationId, input, trx);
    return this.createGame(
      organizationId,
      access,
      input,
      {
        competitionKind: input.competitionKind,
        matchupId: input.matchupId,
      },
      trx,
      false,
    );
  }

  /** Finish the post-commit portion of a competition-game schedule request. */
  async completeCompetitionGame(
    organizationId: string,
    access: OrganizationAccessContext,
    inserted: { id: string },
    input: Pick<CompetitionScheduleInput, 'scorekeeperMemberId' | 'status'>,
  ) {
    let game: any = inserted;
    try {
      game = await this.findOne(organizationId, inserted.id);
    } catch {
      // The official transaction has already committed. Return its durable
      // inserted record if read enrichment is temporarily unavailable.
      game = inserted;
    }
    const notifications: Promise<unknown>[] = [];
    if (input.status === 'scheduled') {
      notifications.push(
        this.notifyGameRecipients(
          organizationId,
          inserted.id,
          access,
          'schedule.game_published',
        ),
      );
    }
    if (input.scorekeeperMemberId) {
      notifications.push(
        this.notifyScorekeeperAssignment(
          organizationId,
          inserted.id,
          access,
          input.scorekeeperMemberId,
          'schedule.scorekeeper_assigned',
        ),
      );
    }
    // Delivery is post-commit best effort. A notification provider outage
    // cannot make a successful official schedule look like a failed write.
    await Promise.allSettled(notifications);
    return game;
  }

  /**
   * Competition games are materialized from a generated matchup. Treat the
   * matchup graph as the source of truth and reject forged or stale requests
   * before any game, assignment, or audit row is written.
   */
  private async assertCompetitionGameIdentity(
    organizationId: string,
    input: CompetitionScheduleInput,
    db: Database | any = this.db,
  ): Promise<void> {
    const matchup = await db
      .selectFrom('competition.matchups as matchups')
      .innerJoin(
        'competition.division_formats as formats',
        'formats.id',
        'matchups.division_format_id',
      )
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'formats.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'matchups.away_team_id',
        'matchups.division_format_id',
        'matchups.format_revision as matchup_format_revision',
        'matchups.home_team_id',
        'matchups.id',
        'matchups.stage',
        'matchups.status as matchup_status',
        'formats.division_id',
        'formats.revision as format_revision',
        'formats.status as format_status',
        'divisions.league_season_id',
        'seasons.organization_id',
      ])
      .where('matchups.id', '=', input.matchupId)
      .executeTakeFirst();

    const expectedKind = matchup?.stage === 'playoff' ? 'playoff' : 'stage';
    const hasExactIdentity =
      matchup &&
      matchup.organization_id === organizationId &&
      matchup.league_season_id === input.leagueSeasonId &&
      matchup.division_id === input.divisionId &&
      matchup.home_team_id === input.homeTeamId &&
      matchup.away_team_id === input.awayTeamId &&
      matchup.stage &&
      expectedKind === input.competitionKind &&
      matchup.matchup_format_revision === matchup.format_revision &&
      matchup.format_status === 'locked' &&
      matchup.matchup_status === 'ready';

    if (!hasExactIdentity) {
      throw new ConflictException(
        'This generated matchup is no longer available for the selected teams and competition.',
      );
    }

    const existingGame = await db
      .selectFrom('competition.games')
      .select('id')
      .where('matchup_id', '=', input.matchupId)
      .executeTakeFirst();

    if (existingGame) {
      throw new ConflictException(
        'This generated matchup already has a scheduled game.',
      );
    }
  }

  private async createGame(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
    competition: {
      competitionKind: 'stage' | 'playoff' | 'exhibition';
      matchupId: string | null;
    },
    transaction?: any,
    notify = true,
  ) {
    this.assertDistinctTeams(
      createScheduleDto.homeTeamId,
      createScheduleDto.awayTeamId,
    );

    const insert = async (trx: any) => {
      const season = await this.lockSeasonForScheduling(
        trx,
        organizationId,
        createScheduleDto.leagueSeasonId,
      );
      await this.assertScheduleRelations(
        organizationId,
        {
          awayTeamId: createScheduleDto.awayTeamId,
          divisionId: createScheduleDto.divisionId,
          homeTeamId: createScheduleDto.homeTeamId,
          leagueSeasonId: createScheduleDto.leagueSeasonId,
          venueId: createScheduleDto.venueId,
        },
        trx,
      );

      if (createScheduleDto.scorekeeperMemberId) {
        await this.assertScorekeeperCanBeAssigned(
          trx,
          organizationId,
          createScheduleDto.scorekeeperMemberId,
        );
      }
      if (createScheduleDto.statisticianMemberId) {
        await this.assertStatisticianCanBeAssigned(
          organizationId,
          createScheduleDto.statisticianMemberId,
          trx,
        );
      }

      if (createScheduleDto.status === 'scheduled') {
        await this.assertNoScheduleConflict(
          {
            awayTeamId: createScheduleDto.awayTeamId,
            homeTeamId: createScheduleDto.homeTeamId,
            leagueSeasonId: createScheduleDto.leagueSeasonId,
            startsAt: new Date(createScheduleDto.startsAt),
            venueId: createScheduleDto.venueId,
            scorekeeperMemberId: createScheduleDto.scorekeeperMemberId,
            statisticianMemberId: createScheduleDto.statisticianMemberId,
          },
          trx,
          season.schedule_slot_duration_minutes,
        );
      }

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
    };

    const inserted = transaction
      ? await insert(transaction)
      : await (this.db as any).transaction().execute(insert);

    if (!notify) return inserted;

    return this.finishCreatedGame(
      organizationId,
      access,
      createScheduleDto,
      inserted,
    );
  }

  private async finishCreatedGame(
    organizationId: string,
    access: OrganizationAccessContext,
    createScheduleDto: CreateScheduleDto,
    inserted: { id: string },
  ) {
    const game = await this.findGameAfterCommit(organizationId, inserted.id);
    const notifications: Promise<unknown>[] = [];
    if (createScheduleDto.status === 'scheduled') {
      notifications.push(
        this.notifyGameRecipients(
          organizationId,
          inserted.id,
          access,
          'schedule.game_published',
        ),
      );
    }
    if (createScheduleDto.scorekeeperMemberId) {
      notifications.push(
        this.notifyScorekeeperAssignmentBestEffort(
          organizationId,
          inserted.id,
          access,
          createScheduleDto.scorekeeperMemberId,
          'schedule.scorekeeper_assigned',
        ),
      );
    }
    await Promise.allSettled(notifications);
    return game;
  }

  private async findGameAfterCommit(organizationId: string, gameId: string) {
    try {
      return await this.findOne(organizationId, gameId);
    } catch {
      // The scheduling transaction has already committed. Return its durable
      // identifier if read enrichment is temporarily unavailable.
      return { id: gameId };
    }
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
    const hasTransaction = typeof (this.db as any).transaction === 'function';
    const initialGame = hasTransaction
      ? undefined
      : await this.findGameRecord(organizationId, gameId);
    const leagueSeasonId =
      initialGame?.league_season_id ??
      (await this.findGameSeasonId(organizationId, gameId));
    const incomingStatus = (updateScheduleDto as { status?: string }).status;
    if (
      incomingStatus !== undefined &&
      !['draft', 'scheduled', 'postponed', 'cancelled'].includes(
        incomingStatus,
      ) &&
      incomingStatus !== 'final'
    ) {
      throw new BadRequestException(
        'Only draft, scheduled, postponed, or cancelled games can be changed here.',
      );
    }
    let existingGame: ScheduleGameRecord | undefined;
    const mutate = async (trx: any) => {
      const season = await this.lockSeasonForScheduling(
        trx,
        organizationId,
        leagueSeasonId,
      );
      await this.lockGameForScheduling(trx, gameId);
      existingGame = hasTransaction
        ? await this.findGameRecord(organizationId, gameId, trx)
        : initialGame;
      if (!existingGame) {
        throw new NotFoundException('Schedule game not found');
      }
      await this.assertGenericUpdateIsAllowed(existingGame, gameId, trx);
      this.assertGameIsNotFinal(existingGame.status);
      if ((updateScheduleDto as { status?: string }).status === 'final') {
        throw new BadRequestException(
          'Use Finalize game to record an official result and update standings.',
        );
      }
      const nextStartsAt = updateScheduleDto.startsAt
        ? new Date(updateScheduleDto.startsAt)
        : existingGame.starts_at;
      const nextStatus = updateScheduleDto.status ?? existingGame.status;
      const assignments = await this.findGameAssignments(trx, gameId);
      await this.assertScheduleRelations(
        organizationId,
        {
          awayTeamId: existingGame.away_team_id,
          divisionId: existingGame.division_id,
          homeTeamId: existingGame.home_team_id,
          leagueSeasonId: existingGame.league_season_id,
          venueId: updateScheduleDto.venueId ?? existingGame.venue_id,
        },
        trx,
      );
      if (nextStatus === 'scheduled') {
        await this.assertNoScheduleConflict(
          {
            awayTeamId: existingGame.away_team_id,
            excludedGameId: gameId,
            homeTeamId: existingGame.home_team_id,
            leagueSeasonId: existingGame.league_season_id,
            scorekeeperMemberId: assignments.scorekeeperMemberId,
            startsAt: nextStartsAt,
            statisticianMemberId: assignments.statisticianMemberId,
            venueId: updateScheduleDto.venueId ?? existingGame.venue_id,
          },
          trx,
          season.schedule_slot_duration_minutes,
        );
      }
      await trx
        .updateTable('competition.games')
        .set({
          published_at: this.resolvePublishedAt(
            existingGame,
            updateScheduleDto,
          ),
          starts_at: updateScheduleDto.startsAt
            ? new Date(updateScheduleDto.startsAt)
            : undefined,
          status: updateScheduleDto.status,
          updated_at: new Date(),
          venue_id: updateScheduleDto.venueId,
        })
        .where('id', '=', gameId)
        .executeTakeFirstOrThrow();
    };
    if (typeof (this.db as any).transaction === 'function') {
      await (this.db as any).transaction().execute(mutate);
    } else {
      await mutate(this.db);
    }

    if (!existingGame) {
      throw new NotFoundException('Schedule game not found');
    }
    const updatedGame = await this.findOne(organizationId, gameId);
    if (updateScheduleDto.status === 'postponed') {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_postponed',
      );
    } else if (
      updateScheduleDto.status === 'scheduled' &&
      !existingGame.published_at
    ) {
      await this.notifyGameRecipients(
        organizationId,
        gameId,
        undefined,
        'schedule.game_published',
      );
    } else if (updateScheduleDto.startsAt || updateScheduleDto.venueId) {
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
    const nextScorekeeperMemberId =
      updateScorekeeperAssignmentDto.scorekeeperMemberId;
    const hasTransaction = typeof (this.db as any).transaction === 'function';
    const initialGame = hasTransaction
      ? undefined
      : await this.findGameRecord(organizationId, gameId);
    if (initialGame) this.assertScorekeeperAssignmentIsOpen(initialGame.status);
    const leagueSeasonId =
      initialGame?.league_season_id ??
      (await this.findGameSeasonId(organizationId, gameId));
    let existingGame: ScheduleGameRecord | undefined;
    let previousAssignment: { organization_member_id: string } | undefined;
    let scorekeeperAssignmentChanged = false;
    const assign = async (trx: any) => {
      const season = await this.lockSeasonForScheduling(
        trx,
        organizationId,
        leagueSeasonId,
      );
      await this.lockGameForScheduling(trx, gameId);
      existingGame = hasTransaction
        ? await this.findGameRecord(organizationId, gameId, trx)
        : initialGame;
      if (!existingGame) throw new NotFoundException('Schedule game not found');
      this.assertScorekeeperAssignmentIsOpen(existingGame.status);
      if (nextScorekeeperMemberId) {
        await this.assertScorekeeperCanBeAssigned(
          trx,
          organizationId,
          nextScorekeeperMemberId,
        );
        if (existingGame.status === 'scheduled') {
          await this.assertNoScheduleConflict(
            {
              awayTeamId: existingGame.away_team_id,
              excludedGameId: gameId,
              homeTeamId: existingGame.home_team_id,
              leagueSeasonId: existingGame.league_season_id,
              scorekeeperMemberId: nextScorekeeperMemberId,
              startsAt: existingGame.starts_at,
              venueId: existingGame.venue_id,
            },
            trx,
            season.schedule_slot_duration_minutes,
          );
        }
      }
      let previousAssignmentQuery = trx
        .selectFrom('access.game_scorekeeper_assignments')
        .select(['organization_member_id'])
        .where('game_id', '=', gameId);
      if (typeof previousAssignmentQuery.forUpdate === 'function') {
        previousAssignmentQuery = previousAssignmentQuery.forUpdate();
      }
      previousAssignment = await previousAssignmentQuery.executeTakeFirst();
      const previousScorekeeperMemberId =
        previousAssignment?.organization_member_id ?? null;
      const nextAssignmentMemberId = nextScorekeeperMemberId ?? null;
      scorekeeperAssignmentChanged =
        previousScorekeeperMemberId !== nextAssignmentMemberId;
      if (scorekeeperAssignmentChanged) {
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
            previousScorekeeperMemberId,
            scorekeeperMemberId: nextAssignmentMemberId,
          },
        );
      }
    };
    if (hasTransaction) {
      await (this.db as any).transaction().execute(assign);
    } else {
      await assign(this.db);
    }

    if (
      scorekeeperAssignmentChanged &&
      previousAssignment?.organization_member_id
    ) {
      await this.notifyScorekeeperAssignmentBestEffort(
        organizationId,
        gameId,
        access,
        previousAssignment.organization_member_id,
        'schedule.scorekeeper_unassigned',
      );
    }
    if (scorekeeperAssignmentChanged && nextScorekeeperMemberId) {
      await this.notifyScorekeeperAssignmentBestEffort(
        organizationId,
        gameId,
        access,
        nextScorekeeperMemberId,
        'schedule.scorekeeper_assigned',
      );
    }

    return this.findGameAfterCommit(organizationId, gameId);
  }

  async updateStatisticianAssignment(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: UpdateStatisticianAssignmentDto,
  ) {
    const statisticianMemberId = dto.statisticianMemberId;
    const hasTransaction = typeof (this.db as any).transaction === 'function';
    const initialGame = hasTransaction
      ? undefined
      : await this.findGameRecord(organizationId, gameId);
    if (initialGame) this.assertScorekeeperAssignmentIsOpen(initialGame.status);
    const leagueSeasonId =
      initialGame?.league_season_id ??
      (await this.findGameSeasonId(organizationId, gameId));
    let existingGame: ScheduleGameRecord | undefined;
    let previous: { organization_member_id: string } | undefined;
    const assign = async (trx: any) => {
      const season = await this.lockSeasonForScheduling(
        trx,
        organizationId,
        leagueSeasonId,
      );
      await this.lockGameForScheduling(trx, gameId);
      existingGame = hasTransaction
        ? await this.findGameRecord(organizationId, gameId, trx)
        : initialGame;
      if (!existingGame) throw new NotFoundException('Schedule game not found');
      this.assertScorekeeperAssignmentIsOpen(existingGame.status);
      if (statisticianMemberId) {
        await this.assertStatisticianCanBeAssigned(
          organizationId,
          statisticianMemberId,
          trx,
        );
        if (existingGame.status === 'scheduled') {
          await this.assertNoScheduleConflict(
            {
              awayTeamId: existingGame.away_team_id,
              excludedGameId: gameId,
              homeTeamId: existingGame.home_team_id,
              leagueSeasonId: existingGame.league_season_id,
              startsAt: existingGame.starts_at,
              statisticianMemberId,
              venueId: existingGame.venue_id,
            },
            trx,
            season.schedule_slot_duration_minutes,
          );
        }
      }
      let previousAssignmentQuery = trx
        .selectFrom('access.game_statistician_assignments')
        .select('organization_member_id')
        .where('game_id', '=', gameId);
      if (typeof previousAssignmentQuery.forUpdate === 'function') {
        previousAssignmentQuery = previousAssignmentQuery.forUpdate();
      }
      previous = await previousAssignmentQuery.executeTakeFirst();
      const previousStatisticianMemberId =
        previous?.organization_member_id ?? null;
      const nextStatisticianMemberId = statisticianMemberId ?? null;
      if (previousStatisticianMemberId !== nextStatisticianMemberId) {
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
            previousStatisticianMemberId,
            statisticianMemberId: nextStatisticianMemberId,
          },
        );
      }
    };
    if (hasTransaction) {
      await (this.db as any).transaction().execute(assign);
    } else {
      await assign(this.db);
    }

    return this.findGameAfterCommit(organizationId, gameId);
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

  /**
   * Assignment writes are official scheduling changes. Notification delivery
   * is secondary and must never turn a committed assignment into a reported
   * failure when the notification provider or enrichment query is unavailable.
   */
  private async notifyScorekeeperAssignmentBestEffort(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    memberId: string,
    eventType: Extract<
      NotificationEventType,
      'schedule.scorekeeper_assigned' | 'schedule.scorekeeper_unassigned'
    >,
  ): Promise<void> {
    try {
      await this.notifyScorekeeperAssignment(
        organizationId,
        gameId,
        access,
        memberId,
        eventType,
      );
    } catch {
      // The assignment is already committed. A later notification retry can
      // recover delivery without asking the administrator to repeat the write.
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
    db: Database | any = this.db,
  ): Promise<void> {
    await this.assertLeagueSeasonBelongsToOrganization(
      organizationId,
      params.leagueSeasonId,
      db,
    );
    await this.assertDivisionBelongsToLeagueSeason(
      params.divisionId,
      params.leagueSeasonId,
      db,
    );
    await this.assertVenueBelongsToLeagueSeason(
      params.venueId,
      params.leagueSeasonId,
      db,
    );
    await this.assertTeamBelongsToDivision(
      params.homeTeamId,
      params.divisionId,
      db,
    );
    await this.assertTeamBelongsToDivision(
      params.awayTeamId,
      params.divisionId,
      db,
    );
  }

  private async assertNoScheduleConflict(
    params: {
      awayTeamId: string;
      excludedGameId?: string;
      homeTeamId: string;
      leagueSeasonId: string;
      scorekeeperMemberId?: string | null;
      startsAt: Date;
      statisticianMemberId?: string | null;
      venueId: string;
    },
    db: Database | any = this.db,
    slotDurationMinutes?: number,
  ): Promise<void> {
    const season =
      slotDurationMinutes === undefined
        ? await db
            .selectFrom('admin.league_seasons')
            .select('schedule_slot_duration_minutes')
            .where('id', '=', params.leagueSeasonId)
            .executeTakeFirstOrThrow()
        : { schedule_slot_duration_minutes: slotDurationMinutes };
    let gamesQuery = db.selectFrom('competition.games as games');
    if (typeof gamesQuery.leftJoin === 'function') {
      gamesQuery = gamesQuery
        .leftJoin(
          'access.game_scorekeeper_assignments as scorekeepers',
          'scorekeepers.game_id',
          'games.id',
        )
        .leftJoin(
          'access.game_statistician_assignments as statisticians',
          'statisticians.game_id',
          'games.id',
        );
    }
    const games = await gamesQuery
      .select([
        'games.away_team_id',
        'games.home_team_id',
        'games.id',
        'games.starts_at',
        'games.venue_id',
        'scorekeepers.organization_member_id as scorekeeper_member_id',
        'statisticians.organization_member_id as statistician_member_id',
      ])
      .where('games.league_season_id', '=', params.leagueSeasonId)
      .where('games.status', 'in', ['scheduled', 'live', 'reopened'])
      .execute();
    const conflict = findScheduleConflict(
      {
        awayTeamId: params.awayTeamId,
        homeTeamId: params.homeTeamId,
        scorekeeperMemberId: params.scorekeeperMemberId,
        startsAt: params.startsAt,
        statisticianMemberId: params.statisticianMemberId,
        venueId: params.venueId,
      },
      season.schedule_slot_duration_minutes,
      games.map((game) => ({
        awayTeamId: game.away_team_id,
        homeTeamId: game.home_team_id,
        id: game.id,
        startsAt: new Date(game.starts_at),
        scorekeeperMemberId: game.scorekeeper_member_id,
        statisticianMemberId: game.statistician_member_id,
        venueId: game.venue_id,
      })),
      params.excludedGameId,
    );

    if (!conflict) return;
    const messages = {
      team: 'One of these teams already has a game during the selected time slot.',
      venue: 'This venue is already booked during the selected time slot.',
      scorekeeper:
        'This scorekeeper is already assigned to another game during the selected time slot.',
      statistician:
        'This statistician is already assigned to another game during the selected time slot.',
    } as const;
    throw new ConflictException(messages[conflict.kind]);
  }

  private async assertLeagueSeasonBelongsToOrganization(
    organizationId: string,
    leagueSeasonId: string,
    db: Database | any = this.db,
  ): Promise<void> {
    const leagueSeason = await db
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
    db: Database | any = this.db,
  ): Promise<void> {
    const division = await db
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
    db: Database | any = this.db,
  ): Promise<void> {
    const venue = await db
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
    db: Database | any = this.db,
  ): Promise<void> {
    const team = await db
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
    db: Database | any = this.db,
  ): Promise<ScheduleGameRecord> {
    const game = await db
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

  private async findGameSeasonId(
    organizationId: string,
    gameId: string,
  ): Promise<string> {
    const game = await this.db
      .selectFrom('competition.games as games')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'games.league_season_id',
      )
      .select('games.league_season_id')
      .where('games.id', '=', gameId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!game) throw new NotFoundException('Schedule game not found');
    return game.league_season_id;
  }

  private async findGameAssignments(
    db: Database | any,
    gameId: string,
  ): Promise<{
    scorekeeperMemberId: string | null;
    statisticianMemberId: string | null;
  }> {
    const [scorekeeper, statistician] = await Promise.all([
      db
        .selectFrom('access.game_scorekeeper_assignments')
        .select('organization_member_id')
        .where('game_id', '=', gameId)
        .executeTakeFirst(),
      db
        .selectFrom('access.game_statistician_assignments')
        .select('organization_member_id')
        .where('game_id', '=', gameId)
        .executeTakeFirst(),
    ]);
    return {
      scorekeeperMemberId: scorekeeper?.organization_member_id ?? null,
      statisticianMemberId: statistician?.organization_member_id ?? null,
    };
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
    let query = db
      .selectFrom('admin.organization_members')
      .select(['id'])
      .where('id', '=', scorekeeperMemberId)
      .where('organization_id', '=', organizationId)
      .where('role', '=', AUTH_ROLES.SCOREKEEPER)
      .where('status', '=', 'active');
    if (typeof query.forUpdate === 'function') query = query.forUpdate();
    const scorekeeper = await query.executeTakeFirst();

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
    db: Database | any = this.db,
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

    const scoringState = await db
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
    db: Database | any = this.db,
  ): Promise<void> {
    let query = db
      .selectFrom('admin.organization_members')
      .select('id')
      .where('id', '=', statisticianMemberId)
      .where('organization_id', '=', organizationId)
      .where('role', '=', AUTH_ROLES.STATISTICIAN)
      .where('status', '=', 'active');
    if (typeof query.forUpdate === 'function') query = query.forUpdate();
    const statistician = await query.executeTakeFirst();

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
