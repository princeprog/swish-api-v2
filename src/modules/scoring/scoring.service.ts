import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import {
  applyScoringCommand,
  applyScoringGameRules,
  createInitialScoringState,
  materializeClocks,
  ScoringActionError,
  type LatestReversibleScoringEvent,
  type ScoringCommand,
  type ScoringEventDraft,
  type ScoringGameRules,
  type ScoringState,
} from './scoring-engine';
import { parseScoringCommand } from './scoring-command.parser';
import { NotificationWriter } from '../notification/notification.writer';
import {
  projectPeriodScores,
  projectPersonalFouls,
  type ScoringProjectionEvent,
} from './scoring-projections';
import { OfficialResultCoordinator } from '../official-result/official-result.service';

type ScheduleGame = {
  away_score: number | null;
  away_team_id: string;
  away_team_name: string;
  division_name: string;
  division_id: string | null;
  home_score: number | null;
  home_team_id: string;
  home_team_name: string;
  id: string;
  league_season_id: string;
  organization_id: string;
  starts_at: Date;
  status: string;
  venue_name: string;
};

type ScoringStateRow = {
  away_score: number;
  away_team_fouls: number;
  away_timeouts_used: number;
  current_period_number: number;
  game_clock_remaining_ms: number;
  game_clock_running: boolean;
  game_clock_started_at: Date | null;
  home_score: number;
  home_team_fouls: number;
  home_timeouts_used: number;
  latest_reversible_event_id: string | null;
  overtime_duration_ms: number;
  overtime_number: number;
  period_duration_ms: number;
  phase: string;
  regulation_periods: number;
  shot_clock_enabled: boolean;
  shot_clock_full_ms: number;
  shot_clock_remaining_ms: number;
  shot_clock_running: boolean;
  shot_clock_short_ms: number;
  shot_clock_started_at: Date | null;
  team_fouls_before_penalty: number;
  timeouts_first_half: number;
  timeouts_per_overtime: number;
  timeouts_second_half: number;
  version: number;
};

@Injectable()
export class ScoringService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Optional() private readonly notificationWriter?: NotificationWriter,
    @Optional()
    private readonly officialResultCoordinator?: OfficialResultCoordinator,
  ) {}

  async getState(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ) {
    const now = new Date();
    const game = await this.findGameForScoring(organizationId, gameId, access);
    const state = materializeClocks(await this.ensureScoringState(game), now);
    const control = await this.getControlStatus(gameId, access, now);

    return {
      ...this.toStateResponse(game, state, control, now),
      ...(await this.findDetailProjections(gameId)),
    };
  }

  async listEvents(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    query: { beforeSequence?: number; limit?: number },
  ) {
    await this.findGameForScoring(organizationId, gameId, access);
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
    let eventsQuery = (this.db as any)
      .selectFrom('scoring.game_events')
      .selectAll()
      .where('game_id', '=', gameId)
      .orderBy('sequence desc')
      .limit(limit);

    if (query.beforeSequence) {
      eventsQuery = eventsQuery.where('sequence', '<', query.beforeSequence);
    }

    return eventsQuery.execute();
  }

  async claimControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    deviceLabel?: string,
  ) {
    const now = new Date();
    await this.findGameForScoring(organizationId, gameId, access);
    await this.releaseExpiredControl(gameId, now);

    const existing = await this.findActiveControl(gameId);
    if (existing) {
      throw new ConflictException({
        code: 'CONTROL_ALREADY_CLAIMED',
        message: 'Another device is controlling this game',
      });
    }

    const controlToken = randomBytes(32).toString('base64url');
    const session = await (this.db as any)
      .insertInto('scoring.game_control_sessions')
      .values({
        control_token_hash: this.hashToken(controlToken),
        device_label: deviceLabel,
        expires_at: new Date(now.getTime() + 120000),
        game_id: gameId,
        last_heartbeat_at: now,
        organization_member_id: access.membershipId,
      })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();

    await this.audit(
      organizationId,
      access,
      'scoring.control.claimed',
      gameId,
      {
        deviceLabel,
        sessionId: session.id,
      },
    );

    return {
      controlToken,
      expiresAt: session.expires_at,
      sessionId: session.id,
    };
  }

  async heartbeatControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string,
  ) {
    await this.findGameForScoring(organizationId, gameId, access);
    const session = await this.assertControlSession(
      gameId,
      access,
      controlToken,
      false,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 120000);

    await (this.db as any)
      .updateTable('scoring.game_control_sessions')
      .set({
        expires_at: expiresAt,
        last_heartbeat_at: now,
      })
      .where('id', '=', session.id)
      .execute();

    return { expiresAt, sessionId: session.id };
  }

  async takeoverControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    input: { deviceLabel?: string; reason: string },
  ) {
    const now = new Date();
    await this.findGameForScoring(organizationId, gameId, access);
    const existing = await this.findActiveControl(gameId);

    if (
      existing &&
      existing.expires_at > now &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE)
    ) {
      throw new ConflictException({
        code: 'CONTROL_ACTIVE',
        message: 'This game is still controlled by another active device',
      });
    }

    const controlToken = randomBytes(32).toString('base64url');
    const session = await (this.db as any)
      .transaction()
      .execute(async (trx) => {
        if (existing) {
          await trx
            .updateTable('scoring.game_control_sessions')
            .set({
              released_at: now,
              release_reason: 'takeover',
              takeover_reason: input.reason,
            })
            .where('id', '=', existing.id)
            .execute();
        }

        return trx
          .insertInto('scoring.game_control_sessions')
          .values({
            control_token_hash: this.hashToken(controlToken),
            device_label: input.deviceLabel,
            expires_at: new Date(now.getTime() + 120000),
            game_id: gameId,
            last_heartbeat_at: now,
            organization_member_id: access.membershipId,
          })
          .returning(['id', 'expires_at'])
          .executeTakeFirstOrThrow();
      });

    await this.audit(
      organizationId,
      access,
      'scoring.control.taken_over',
      gameId,
      {
        reason: input.reason,
        sessionId: session.id,
      },
    );

    if (this.notificationWriter && existing) {
      const [organization, game, member] = await Promise.all([
        this.db
          .selectFrom('admin.organizations')
          .select(['name', 'slug'])
          .where('id', '=', organizationId)
          .executeTakeFirstOrThrow(),
        this.findGameForScoring(organizationId, gameId, access),
        (this.db as any)
          .selectFrom('admin.organization_members')
          .select(['user_id'])
          .where('id', '=', existing.organization_member_id)
          .where('status', '=', 'active')
          .executeTakeFirst(),
      ]);
      if (member) {
        await this.notificationWriter.create({
          actorUserId: access.userId,
          context: {
            gameId,
            gameLabel: `${game.home_team_name} vs ${game.away_team_name}`,
            organizationName: organization.name,
            organizationSlug: organization.slug,
            reason: input.reason,
          },
          dedupeKey: `game:${gameId}:control-takeover:${session.id}`,
          eventType: 'scoring.control_taken_over',
          organizationId,
          recipients: [{ userId: member.user_id }],
          resourceId: gameId,
          resourceType: 'game',
        });
      }
    }

    return {
      controlToken,
      expiresAt: session.expires_at,
      sessionId: session.id,
    };
  }

  async releaseControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string,
  ) {
    await this.findGameForScoring(organizationId, gameId, access);
    const session = await this.assertControlSession(
      gameId,
      access,
      controlToken,
      true,
    );
    const now = new Date();

    await (this.db as any)
      .updateTable('scoring.game_control_sessions')
      .set({
        released_at: now,
        release_reason: 'released',
      })
      .where('id', '=', session.id)
      .execute();

    await this.audit(
      organizationId,
      access,
      'scoring.control.released',
      gameId,
      {
        sessionId: session.id,
      },
    );

    return { success: true };
  }

  async executeCommand(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    input: {
      command: ScoringCommand;
      controlToken?: string;
      expectedVersion: number;
      occurredAt: Date;
    },
  ) {
    input.command = parseScoringCommand(input.command);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    ) {
      throw new BadRequestException('The game changed. Refresh it and try again.');
    }
    if (
      !(input.occurredAt instanceof Date) ||
      Number.isNaN(input.occurredAt.getTime())
    ) {
      throw new BadRequestException('Choose a valid game time and try again.');
    }
    if (
      input.controlToken !== undefined &&
      (typeof input.controlToken !== 'string' ||
        !input.controlToken.trim() ||
        input.controlToken.length > 512)
    ) {
      throw new BadRequestException('Your scoring control is no longer valid. Claim control again.');
    }
    const now = new Date();
    const game = await this.findGameForScoring(organizationId, gameId, access);
    await this.assertControlSession(gameId, access, input.controlToken, false);

    if (
      input.command.type === 'game.reopen' &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE)
    ) {
      throw new ForbiddenException(
        'Only authorized league administrators can reopen an official result',
      );
    }

    try {
      const result = await (this.db as any)
        .transaction()
        .execute(async (trx) => {
          const existingEvent = await trx
            .selectFrom('scoring.game_events')
            .selectAll()
            .where('game_id', '=', gameId)
            .where('idempotency_key', '=', input.command.idempotencyKey)
            .executeTakeFirst();

          if (existingEvent) {
            const state = await this.ensureScoringState(game, trx);
            return {
              event: existingEvent,
              state: this.toStateResponse(
                game,
                state,
                await this.getControlStatus(gameId, access, now, trx),
                now,
              ),
            };
          }

          const lockedState = await this.ensureScoringState(game, trx, true);
          if (lockedState.version !== input.expectedVersion) {
            throw new ConflictException({
              code: 'STALE_SCORING_STATE',
              message: 'The scoring state has changed',
            });
          }

          if (
            input.command.type === 'game.start' &&
            game.status !== 'scheduled'
          ) {
            throw new ScoringActionError(
              'GAME_START_STATUS_INVALID',
              'Only scheduled games can be started',
            );
          }

          if (input.command.type === 'game.start') {
            await this.ensureGameRosterSnapshots(game, trx);
          }
          if (input.command.type === 'personal_foul.record') {
            await this.assertPersonalFoulPlayer(
              gameId,
              input.command.payload.playerId,
              input.command.payload.teamId,
              trx,
            );
          }

          const applied = applyScoringCommand(lockedState, input.command, now);
          let responseGame = game;

          const insertedEvent = await this.insertEvent(
            trx,
            gameId,
            access.membershipId,
            applied.event,
            input.occurredAt,
          );
          await this.updateProjection(
            trx,
            gameId,
            applied.state,
            insertedEvent.id,
          );
          if (
            ['score.record', 'personal_foul.record', 'event.reverse'].includes(
              input.command.type,
            )
          ) {
            await this.rebuildDetailProjections(game, trx);
          }

          if (input.command.type === 'game.start') {
            await trx
              .updateTable('competition.games')
              .set({
                status: 'live',
                updated_at: now,
              })
              .where('id', '=', gameId)
              .execute();
            responseGame = { ...game, status: 'live' };
          }

          if (input.command.type === 'game.finalize') {
            if (!this.officialResultCoordinator) {
              throw new Error('Official result coordinator is unavailable');
            }
            await this.officialResultCoordinator.finalizeInTransaction(trx, {
              access,
              awayScore: applied.state.awayScore,
              gameId,
              homeScore: applied.state.homeScore,
              organizationId,
              source: 'scorekeeper',
            });
            responseGame = { ...game, status: 'final' };
          }

          if (input.command.type === 'game.reopen') {
            if (!this.officialResultCoordinator) {
              throw new Error('Official result coordinator is unavailable');
            }
            await this.officialResultCoordinator.reopenInTransaction(trx, {
              access,
              gameId,
              organizationId,
              reason: input.command.payload.reason,
            });
            responseGame = { ...game, status: 'reopened' };
          }

          const responseState = {
            ...applied.state,
            latestReversibleEvent: applied.state.latestReversibleEvent
              ? {
                  ...applied.state.latestReversibleEvent,
                  id: insertedEvent.id,
                }
              : null,
          };

          return {
            event: insertedEvent,
            state: this.toStateResponse(
              responseGame,
              responseState,
              await this.getControlStatus(gameId, access, now, trx),
              now,
            ),
          };
        });

      result.state = {
        ...result.state,
        ...(await this.findDetailProjections(gameId)),
      };

      if (this.notificationWriter) {
        if (input.command.type === 'game.reopen') {
          await this.notifyOfficialResult(
            organizationId,
            game,
            access,
            'scoring.game_reopened',
          );
        }
      }

      return result;
    } catch (error) {
      if (error instanceof ScoringActionError) {
        throw new BadRequestException({
          code: error.code,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async notifyOfficialResult(
    organizationId: string,
    game: ScheduleGame,
    access: OrganizationAccessContext,
    eventType:
      | 'scoring.game_finalized'
      | 'scoring.result_corrected'
      | 'scoring.game_reopened',
    resultLabel?: string,
  ) {
    if (!this.notificationWriter) {
      return;
    }

    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['name', 'slug'])
      .where('id', '=', organizationId)
      .executeTakeFirstOrThrow();
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
    const recipients = managers.map((row: { user_id: string }) => ({
      userId: row.user_id,
    }));

    if (eventType !== 'scoring.game_finalized') {
      const administrators = await (this.db as any)
        .selectFrom('admin.organization_members')
        .select(['user_id'])
        .where('organization_id', '=', organizationId)
        .where('status', '=', 'active')
        .where('role', 'in', ['owner', 'admin'])
        .execute();
      recipients.push(
        ...administrators.map((row: { user_id: string }) => ({
          userId: row.user_id,
        })),
      );
    }

    const scorekeepers = await (this.db as any)
      .selectFrom('access.game_scorekeeper_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.game_id', '=', game.id)
      .where('members.status', '=', 'active')
      .execute();
    if (eventType !== 'scoring.game_finalized') {
      recipients.push(
        ...scorekeepers.map((row: { user_id: string }) => ({
          userId: row.user_id,
        })),
      );
    }

    await this.notificationWriter.create({
      actorUserId: access.userId,
      context: {
        gameId: game.id,
        gameLabel: `${game.home_team_name} vs ${game.away_team_name}`,
        organizationName: organization.name,
        organizationSlug: organization.slug,
        resultLabel,
      },
      dedupeKey: `game:${game.id}:${eventType}:${new Date().toISOString()}`,
      eventType,
      organizationId,
      recipients,
      resourceId: game.id,
      resourceType: 'game',
    });
  }

  private async audit(
    organizationId: string,
    access: OrganizationAccessContext,
    action: string,
    gameId: string,
    metadata: Record<string, unknown>,
  ) {
    await (this.db as any)
      .insertInto('access.audit_events')
      .values({
        action,
        actor_member_id: access.membershipId,
        metadata,
        organization_id: organizationId,
        target_id: gameId,
        target_type: 'game',
      })
      .execute();
  }

  private async assertControlSession(
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string | undefined,
    allowExpired: boolean,
  ) {
    if (!controlToken) {
      throw new ConflictException({
        code: 'CONTROL_REQUIRED',
        message: 'Claim scoring control before recording commands',
      });
    }

    const session = await this.findActiveControl(gameId);
    const now = new Date();

    if (!session) {
      throw new ConflictException({
        code: 'CONTROL_REQUIRED',
        message: 'Claim scoring control before recording commands',
      });
    }

    if (
      session.organization_member_id !== access.membershipId &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE)
    ) {
      throw new ForbiddenException('This device does not control this game');
    }

    if (session.control_token_hash !== this.hashToken(controlToken)) {
      throw new ConflictException({
        code: 'CONTROL_TOKEN_MISMATCH',
        message: 'This scoring device no longer controls the game',
      });
    }

    if (!allowExpired && session.expires_at <= now) {
      throw new ConflictException({
        code: 'CONTROL_EXPIRED',
        message: 'Scoring control expired',
      });
    }

    return session;
  }

  private async ensureScoringState(
    game: ScheduleGame,
    db: any = this.db,
    forUpdate = false,
  ): Promise<ScoringState> {
    let query = db
      .selectFrom('scoring.game_states')
      .selectAll()
      .where('game_id', '=', game.id);

    if (forUpdate && typeof query.forUpdate === 'function') {
      query = query.forUpdate();
    }

    const row = await query.executeTakeFirst();
    if (row) {
      const storedState = this.toEngineState(
        game,
        row,
        await this.findLatestEvent(row, db),
      );

      if (storedState.phase !== 'pregame') {
        return storedState;
      }

      return applyScoringGameRules(
        storedState,
        await this.findSeasonGameRules(game.league_season_id, db, forUpdate),
      );
    }

    const gameRules = await this.findSeasonGameRules(
      game.league_season_id,
      db,
      forUpdate,
    );

    const initial = createInitialScoringState({
      awayScore: game.away_score,
      awayTeamId: game.away_team_id,
      gameId: game.id,
      gameRules,
      homeScore: game.home_score,
      homeTeamId: game.home_team_id,
      phase: game.status === 'final' ? 'final' : 'pregame',
    });

    const inserted = await db
      .insertInto('scoring.game_states')
      .values({
        away_score: initial.awayScore,
        away_team_fouls: initial.awayTeamFouls,
        away_timeouts_used: initial.awayTimeoutsUsed,
        game_clock_remaining_ms: initial.gameClockRemainingMs,
        game_clock_running: initial.gameClockRunning,
        game_id: game.id,
        home_score: initial.homeScore,
        home_team_fouls: initial.homeTeamFouls,
        home_timeouts_used: initial.homeTimeoutsUsed,
        overtime_duration_ms: initial.overtimeDurationMs,
        period_duration_ms: initial.periodDurationMs,
        phase: initial.phase,
        regulation_periods: initial.regulationPeriods,
        shot_clock_enabled: initial.shotClockEnabled,
        shot_clock_full_ms: initial.shotClockFullMs,
        shot_clock_remaining_ms: initial.shotClockRemainingMs,
        shot_clock_running: initial.shotClockRunning,
        shot_clock_short_ms: initial.shotClockShortMs,
        team_fouls_before_penalty: initial.teamFoulsBeforePenalty,
        timeouts_first_half: initial.timeoutsFirstHalf,
        timeouts_per_overtime: initial.timeoutsPerOvertime,
        timeouts_second_half: initial.timeoutsSecondHalf,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.toEngineState(game, inserted, null);
  }

  private async ensureGameRosterSnapshots(game: ScheduleGame, db: any) {
    const existing = await db
      .selectFrom('scoring.game_roster_snapshots')
      .select(['id', 'team_id'])
      .where('game_id', '=', game.id)
      .execute();
    const existingTeams = new Set(
      existing.map((row: { team_id: string }) => row.team_id),
    );

    for (const teamId of [game.home_team_id, game.away_team_id]) {
      if (existingTeams.has(teamId)) continue;
      const roster = await db
        .selectFrom('admin.team_rosters')
        .select('published_version_id')
        .where('team_id', '=', teamId)
        .executeTakeFirst();
      if (!roster?.published_version_id) {
        throw new ScoringActionError(
          'ROSTER_NOT_PUBLISHED',
          'Publish both team rosters before starting the game.',
        );
      }
      const players = await db
        .selectFrom('admin.roster_version_players')
        .selectAll()
        .where('roster_version_id', '=', roster.published_version_id)
        .orderBy('sort_order asc')
        .execute();
      const snapshot = await db
        .insertInto('scoring.game_roster_snapshots')
        .values({
          game_id: game.id,
          source_roster_version_id: roster.published_version_id,
          team_id: teamId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (players.length > 0) {
        await db
          .insertInto('scoring.game_roster_players')
          .values(
            players.map(
              (player: {
                jersey_number: string;
                name: string;
                position: string | null;
                sort_order: number;
                source_player_id: string | null;
              }) => ({
                game_roster_snapshot_id: snapshot.id,
                jersey_number: player.jersey_number,
                name: player.name,
                position: player.position,
                sort_order: player.sort_order,
                source_player_id: player.source_player_id,
              }),
            ),
          )
          .execute();
      }
    }
  }

  private async assertPersonalFoulPlayer(
    gameId: string,
    playerId: string,
    teamId: string,
    db: any,
  ) {
    const player = await db
      .selectFrom('scoring.game_roster_players as players')
      .innerJoin(
        'scoring.game_roster_snapshots as snapshots',
        'snapshots.id',
        'players.game_roster_snapshot_id',
      )
      .select('players.id')
      .where('players.id', '=', playerId)
      .where('snapshots.game_id', '=', gameId)
      .where('snapshots.team_id', '=', teamId)
      .executeTakeFirst();
    if (!player) {
      throw new ScoringActionError(
        'PLAYER_NOT_ON_GAME_ROSTER',
        'Choose a player from the published game roster.',
      );
    }
  }

  private async rebuildDetailProjections(game: ScheduleGame, db: any) {
    const [eventRows, rules] = await Promise.all([
      db
        .selectFrom('scoring.game_events')
        .select([
          'id',
          'overtime_number',
          'payload',
          'period_number',
          'reverses_event_id',
          'type',
        ])
        .where('game_id', '=', game.id)
        .orderBy('sequence asc')
        .execute(),
      db
        .selectFrom('admin.league_season_game_rules')
        .select('personal_foul_limit')
        .where('league_season_id', '=', game.league_season_id)
        .executeTakeFirstOrThrow(),
    ]);
    const events: ScoringProjectionEvent[] = eventRows.map(
      (event: {
        id: string;
        overtime_number: number;
        payload: Record<string, unknown>;
        period_number: number;
        reverses_event_id: string | null;
        type: string;
      }) => ({
        id: event.id,
        overtimeNumber: event.overtime_number,
        payload: event.payload,
        periodNumber: event.period_number,
        reversesEventId: event.reverses_event_id,
        type: event.type,
      }),
    );
    const periodScores = projectPeriodScores(
      events,
      game.home_team_id,
      game.away_team_id,
    );
    const playerFouls = projectPersonalFouls(
      events,
      rules.personal_foul_limit,
    );

    await db
      .deleteFrom('scoring.game_period_scores')
      .where('game_id', '=', game.id)
      .execute();
    if (periodScores.length > 0) {
      await db
        .insertInto('scoring.game_period_scores')
        .values(
          periodScores.map((period) => ({
            away_score: period.awayScore,
            game_id: game.id,
            home_score: period.homeScore,
            overtime_number: period.overtimeNumber,
            period_number: period.periodNumber,
          })),
        )
        .execute();
    }
    await db
      .deleteFrom('scoring.player_foul_totals')
      .where('game_id', '=', game.id)
      .execute();
    if (playerFouls.length > 0) {
      await db
        .insertInto('scoring.player_foul_totals')
        .values(
          playerFouls.map((foul) => ({
            fouled_out: foul.fouledOut,
            game_id: game.id,
            game_roster_player_id: foul.playerId,
            personal_fouls: foul.personalFouls,
            team_id: foul.teamId,
          })),
        )
        .execute();
    }
  }

  private async findDetailProjections(gameId: string) {
    const [periodScores, playerFouls, roster] = await Promise.all([
      this.db
        .selectFrom('scoring.game_period_scores')
        .selectAll()
        .where('game_id', '=', gameId)
        .orderBy('period_number asc')
        .orderBy('overtime_number asc')
        .execute(),
      this.db
        .selectFrom('scoring.player_foul_totals as fouls')
        .innerJoin(
          'scoring.game_roster_players as players',
          'players.id',
          'fouls.game_roster_player_id',
        )
        .select([
          'fouls.fouled_out',
          'fouls.game_roster_player_id',
          'players.jersey_number',
          'players.name',
          'fouls.personal_fouls',
          'fouls.team_id',
        ])
        .where('fouls.game_id', '=', gameId)
        .orderBy('fouls.team_id asc')
        .orderBy('players.name asc')
        .execute(),
      this.db
        .selectFrom('scoring.game_roster_players as players')
        .innerJoin(
          'scoring.game_roster_snapshots as snapshots',
          'snapshots.id',
          'players.game_roster_snapshot_id',
        )
        .select([
          'players.id',
          'players.jersey_number',
          'players.name',
          'players.position',
          'players.sort_order',
          'snapshots.team_id',
        ])
        .where('snapshots.game_id', '=', gameId)
        .orderBy('snapshots.team_id asc')
        .orderBy('players.sort_order asc')
        .execute(),
    ]);
    return { periodScores, playerFouls, roster };
  }

  private async findSeasonGameRules(
    leagueSeasonId: string,
    db: any,
    forShare = false,
  ): Promise<ScoringGameRules> {
    let query = db
      .selectFrom('admin.league_season_game_rules')
      .selectAll()
      .where('league_season_id', '=', leagueSeasonId);

    if (forShare && typeof query.forShare === 'function') {
      query = query.forShare();
    }

    const rules = await query.executeTakeFirst();
    if (!rules) {
      throw new NotFoundException('Game rules were not found for this season');
    }

    return {
      overtimeDurationMs: rules.overtime_duration_ms,
      periodDurationMs: rules.period_duration_ms,
      regulationPeriods: rules.regulation_periods,
      shotClockEnabled: rules.shot_clock_enabled,
      shotClockFullMs: rules.shot_clock_full_ms,
      shotClockShortMs: rules.shot_clock_short_ms,
      teamFoulsBeforePenalty: rules.team_fouls_before_penalty,
      timeoutsFirstHalf: rules.timeouts_first_half,
      timeoutsPerOvertime: rules.timeouts_per_overtime,
      timeoutsSecondHalf: rules.timeouts_second_half,
    };
  }

  private async findActiveControl(gameId: string, db: any = this.db) {
    return db
      .selectFrom('scoring.game_control_sessions')
      .selectAll()
      .where('game_id', '=', gameId)
      .where('released_at', 'is', null)
      .executeTakeFirst();
  }

  private async findGameForScoring(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ): Promise<ScheduleGame> {
    let query = (this.db as any)
      .selectFrom('admin.schedule_games')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .where('id', '=', gameId);

    if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE)
    ) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('access.game_scorekeeper_assignments as assignments')
            .select('assignments.id')
            .where(
              'assignments.organization_member_id',
              '=',
              access.membershipId,
            )
            .whereRef('assignments.game_id', '=', 'admin.schedule_games.id'),
        ),
      );
    }

    const game = await query.executeTakeFirst();
    if (!game) {
      throw new NotFoundException('Scoring game not found');
    }

    return game;
  }

  private async findLatestEvent(
    row: ScoringStateRow,
    db: any,
  ): Promise<LatestReversibleScoringEvent | null> {
    if (!row.latest_reversible_event_id) {
      return null;
    }

    const event = await db
      .selectFrom('scoring.game_events')
      .select(['id', 'payload', 'type'])
      .where('id', '=', row.latest_reversible_event_id)
      .executeTakeFirst();

    if (
      !event ||
      ![
        'score.record',
        'personal_foul.record',
        'team_foul.record',
        'timeout.record',
      ].includes(
        event.type,
      )
    ) {
      return null;
    }

    return {
      id: event.id,
      payload: event.payload,
      summary: this.summarizeEvent(event.type, event.payload),
      type: event.type,
    };
  }

  private async getControlStatus(
    gameId: string,
    access: OrganizationAccessContext,
    now: Date,
    db: any = this.db,
  ) {
    const session = await this.findActiveControl(gameId, db);
    if (!session) {
      return { controlledByMe: false, expiresAt: null, status: 'available' };
    }

    return {
      controlledByMe: session.organization_member_id === access.membershipId,
      expiresAt: session.expires_at,
      sessionId: session.id,
      status: session.expires_at <= now ? 'expired' : 'claimed',
    };
  }

  private hashToken(controlToken: string) {
    return createHash('sha256').update(controlToken).digest('hex');
  }

  private async insertEvent(
    db: any,
    gameId: string,
    actorMemberId: string,
    event: ScoringEventDraft,
    occurredAtClient: Date,
  ) {
    return db
      .insertInto('scoring.game_events')
      .values({
        actor_member_id: actorMemberId,
        game_clock_remaining_ms: event.gameClockRemainingMs,
        game_id: gameId,
        idempotency_key: event.idempotencyKey,
        occurred_at_client: occurredAtClient,
        overtime_number: event.overtimeNumber,
        payload: event.payload,
        period_number: event.periodNumber,
        reverses_event_id: event.reversesEventId,
        sequence: event.sequence,
        shot_clock_remaining_ms: event.shotClockRemainingMs,
        type: event.type,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  private async releaseExpiredControl(gameId: string, now: Date) {
    await (this.db as any)
      .updateTable('scoring.game_control_sessions')
      .set({
        released_at: now,
        release_reason: 'expired',
      })
      .where('game_id', '=', gameId)
      .where('released_at', 'is', null)
      .where('expires_at', '<=', now)
      .execute();
  }

  private summarizeEvent(type: string, payload: Record<string, unknown>) {
    if (type === 'score.record') {
      const points =
        typeof payload.points === 'number' || typeof payload.points === 'string'
          ? payload.points
          : '';

      return `Score +${points}`.trim();
    }

    if (type === 'timeout.record') {
      return 'Timeout';
    }

    if (type === 'personal_foul.record') {
      return 'Personal foul';
    }

    return 'Team foul';
  }

  private toEngineState(
    game: ScheduleGame,
    row: ScoringStateRow,
    latestReversibleEvent: LatestReversibleScoringEvent | null,
  ): ScoringState {
    const timeoutSegment =
      row.overtime_number > 0
        ? 'overtime'
        : row.current_period_number <= Math.ceil(row.regulation_periods / 2)
          ? 'first_half'
          : 'second_half';
    const timeoutAllowancePerTeam =
      timeoutSegment === 'overtime'
        ? row.timeouts_per_overtime
        : timeoutSegment === 'first_half'
          ? row.timeouts_first_half
          : row.timeouts_second_half;

    return {
      awayScore: row.away_score,
      awayTeamFouls: row.away_team_fouls,
      awayTimeoutsRemaining: Math.max(
        0,
        timeoutAllowancePerTeam - row.away_timeouts_used,
      ),
      awayTimeoutsUsed: row.away_timeouts_used,
      awayInPenalty: row.away_team_fouls >= row.team_fouls_before_penalty,
      awayTeamId: game.away_team_id,
      currentPeriodNumber: row.current_period_number,
      gameClockRemainingMs: row.game_clock_remaining_ms,
      gameClockRunning: row.game_clock_running,
      gameClockStartedAt: row.game_clock_started_at,
      gameId: game.id,
      homeScore: row.home_score,
      homeTeamFouls: row.home_team_fouls,
      homeTimeoutsRemaining: Math.max(
        0,
        timeoutAllowancePerTeam - row.home_timeouts_used,
      ),
      homeTimeoutsUsed: row.home_timeouts_used,
      homeInPenalty: row.home_team_fouls >= row.team_fouls_before_penalty,
      homeTeamId: game.home_team_id,
      latestReversibleEvent,
      overtimeDurationMs: row.overtime_duration_ms,
      overtimeNumber: row.overtime_number,
      periodDurationMs: row.period_duration_ms,
      phase: row.phase as ScoringState['phase'],
      regulationPeriods: row.regulation_periods,
      sequence: row.version,
      shotClockEnabled: row.shot_clock_enabled,
      shotClockFullMs: row.shot_clock_full_ms,
      shotClockRemainingMs: row.shot_clock_remaining_ms,
      shotClockRunning: row.shot_clock_running,
      shotClockShortMs: row.shot_clock_short_ms,
      shotClockStartedAt: row.shot_clock_started_at,
      teamFoulsBeforePenalty: row.team_fouls_before_penalty,
      timeoutAllowancePerTeam,
      timeoutSegment,
      timeoutsFirstHalf: row.timeouts_first_half,
      timeoutsPerOvertime: row.timeouts_per_overtime,
      timeoutsSecondHalf: row.timeouts_second_half,
      version: row.version,
    };
  }

  private toStateResponse(
    game: ScheduleGame,
    state: ScoringState,
    control: Record<string, unknown>,
    now: Date,
  ) {
    return {
      clock: {
        gameClockRemainingMs: state.gameClockRemainingMs,
        gameClockRunning: state.gameClockRunning,
        gameClockStartedAt: state.gameClockStartedAt,
        shotClockRemainingMs: state.shotClockRemainingMs,
        shotClockRunning: state.shotClockRunning,
        shotClockStartedAt: state.shotClockStartedAt,
      },
      config: {
        overtimeDurationMs: state.overtimeDurationMs,
        periodDurationMs: state.periodDurationMs,
        regulationPeriods: state.regulationPeriods,
        shotClockEnabled: state.shotClockEnabled,
        shotClockFullMs: state.shotClockFullMs,
        shotClockShortMs: state.shotClockShortMs,
        teamFoulsBeforePenalty: state.teamFoulsBeforePenalty,
        timeoutsFirstHalf: state.timeoutsFirstHalf,
        timeoutsPerOvertime: state.timeoutsPerOvertime,
        timeoutsSecondHalf: state.timeoutsSecondHalf,
      },
      control,
      fouls: {
        away: state.awayTeamFouls,
        awayInPenalty: state.awayInPenalty,
        home: state.homeTeamFouls,
        homeInPenalty: state.homeInPenalty,
        penaltyAt: state.teamFoulsBeforePenalty,
      },
      game: {
        awayTeam: {
          id: game.away_team_id,
          name: game.away_team_name,
        },
        divisionName: game.division_name,
        homeTeam: {
          id: game.home_team_id,
          name: game.home_team_name,
        },
        id: game.id,
        startsAt: game.starts_at,
        status: game.status,
        venueName: game.venue_name,
      },
      latestReversibleEvent: state.latestReversibleEvent,
      period: {
        label:
          state.overtimeNumber > 0
            ? `OT${state.overtimeNumber}`
            : `Q${state.currentPeriodNumber}`,
        number: state.currentPeriodNumber,
        overtimeNumber: state.overtimeNumber,
      },
      phase: state.phase,
      scores: {
        away: state.awayScore,
        home: state.homeScore,
      },
      serverTime: now,
      timeouts: {
        allowancePerTeam: state.timeoutAllowancePerTeam,
        away: {
          remaining: state.awayTimeoutsRemaining,
          used: state.awayTimeoutsUsed,
        },
        home: {
          remaining: state.homeTimeoutsRemaining,
          used: state.homeTimeoutsUsed,
        },
        segment: state.timeoutSegment,
      },
      version: state.version,
    };
  }

  private async updateProjection(
    db: any,
    gameId: string,
    state: ScoringState,
    insertedEventId: string,
  ) {
    await db
      .updateTable('scoring.game_states')
      .set({
        away_score: state.awayScore,
        away_team_fouls: state.awayTeamFouls,
        away_timeouts_used: state.awayTimeoutsUsed,
        current_period_number: state.currentPeriodNumber,
        game_clock_remaining_ms: state.gameClockRemainingMs,
        game_clock_running: state.gameClockRunning,
        game_clock_started_at: state.gameClockStartedAt,
        home_score: state.homeScore,
        home_team_fouls: state.homeTeamFouls,
        home_timeouts_used: state.homeTimeoutsUsed,
        latest_reversible_event_id: state.latestReversibleEvent
          ? insertedEventId
          : null,
        overtime_number: state.overtimeNumber,
        overtime_duration_ms: state.overtimeDurationMs,
        period_duration_ms: state.periodDurationMs,
        phase: state.phase,
        regulation_periods: state.regulationPeriods,
        shot_clock_enabled: state.shotClockEnabled,
        shot_clock_full_ms: state.shotClockFullMs,
        shot_clock_remaining_ms: state.shotClockRemainingMs,
        shot_clock_running: state.shotClockRunning,
        shot_clock_short_ms: state.shotClockShortMs,
        shot_clock_started_at: state.shotClockStartedAt,
        team_fouls_before_penalty: state.teamFoulsBeforePenalty,
        timeouts_first_half: state.timeoutsFirstHalf,
        timeouts_per_overtime: state.timeoutsPerOvertime,
        timeouts_second_half: state.timeoutsSecondHalf,
        updated_at: new Date(),
        version: state.version,
      })
      .where('game_id', '=', gameId)
      .execute();
  }
}
