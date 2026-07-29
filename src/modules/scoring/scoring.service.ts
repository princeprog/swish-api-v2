import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import {
  applyScoringCommand,
  createInitialScoringState,
  materializeClocks,
  ScoringActionError,
  type LatestReversibleScoringEvent,
  type ScoringCommand,
  type ScoringEventDraft,
  type ScoringState,
} from './scoring-engine';

type ScheduleGame = {
  away_score: number | null;
  away_team_id: string;
  away_team_name: string;
  division_name: string;
  home_score: number | null;
  home_team_id: string;
  home_team_name: string;
  id: string;
  organization_id: string;
  starts_at: Date;
  status: string;
  venue_name: string;
};

type ScoringStateRow = {
  away_score: number;
  away_team_fouls: number;
  current_period_number: number;
  game_clock_remaining_ms: number;
  game_clock_running: boolean;
  game_clock_started_at: Date | null;
  home_score: number;
  home_team_fouls: number;
  latest_reversible_event_id: string | null;
  overtime_duration_ms: number;
  overtime_number: number;
  period_duration_ms: number;
  phase: string;
  regulation_periods: number;
  shot_clock_full_ms: number;
  shot_clock_remaining_ms: number;
  shot_clock_running: boolean;
  shot_clock_short_ms: number;
  shot_clock_started_at: Date | null;
  version: number;
};

@Injectable()
export class ScoringService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getState(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ) {
    const now = new Date();
    const game = await this.findGameForScoring(organizationId, gameId, access);
    const state = materializeClocks(
      await this.ensureScoringState(game),
      now,
    );
    const control = await this.getControlStatus(gameId, access, now);

    return this.toStateResponse(game, state, control, now);
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

    await this.audit(organizationId, access, 'scoring.control.claimed', gameId, {
      deviceLabel,
      sessionId: session.id,
    });

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
    const session = await (this.db as any).transaction().execute(async (trx) => {
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

    await this.audit(organizationId, access, 'scoring.control.taken_over', gameId, {
      reason: input.reason,
      sessionId: session.id,
    });

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

    await this.audit(organizationId, access, 'scoring.control.released', gameId, {
      sessionId: session.id,
    });

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
    const now = new Date();
    const game = await this.findGameForScoring(organizationId, gameId, access);
    await this.assertControlSession(
      gameId,
      access,
      input.controlToken,
      false,
    );

    try {
      const result = await (this.db as any).transaction().execute(async (trx) => {
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

        const applied = applyScoringCommand(
          lockedState,
          input.command,
          now,
        );

        const insertedEvent = await this.insertEvent(
          trx,
          gameId,
          access.membershipId,
          applied.event,
          input.occurredAt,
        );
        await this.updateProjection(trx, gameId, applied.state, insertedEvent.id);

        if (input.command.type === 'game.finalize') {
          await trx
            .updateTable('competition.games')
            .set({
              away_score: applied.state.awayScore,
              finalized_at: now,
              home_score: applied.state.homeScore,
              status: 'final',
              updated_at: now,
            })
            .where('id', '=', gameId)
            .execute();
        }

        if (input.command.type === 'game.reopen') {
          await trx
            .updateTable('competition.games')
            .set({
              finalized_at: null,
              status: 'reopened',
              updated_at: now,
            })
            .where('id', '=', gameId)
            .execute();
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
            game,
            responseState,
            await this.getControlStatus(gameId, access, now, trx),
            now,
          ),
        };
      });

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
      return this.toEngineState(game, row, await this.findLatestEvent(row, db));
    }

    const initial = createInitialScoringState({
      awayScore: game.away_score,
      awayTeamId: game.away_team_id,
      gameId: game.id,
      homeScore: game.home_score,
      homeTeamId: game.home_team_id,
      phase: game.status === 'final' ? 'final' : 'pregame',
    });

    const inserted = await db
      .insertInto('scoring.game_states')
      .values({
        away_score: initial.awayScore,
        away_team_fouls: initial.awayTeamFouls,
        game_clock_remaining_ms: initial.gameClockRemainingMs,
        game_clock_running: initial.gameClockRunning,
        game_id: game.id,
        home_score: initial.homeScore,
        home_team_fouls: initial.homeTeamFouls,
        overtime_duration_ms: initial.overtimeDurationMs,
        period_duration_ms: initial.periodDurationMs,
        phase: initial.phase,
        regulation_periods: initial.regulationPeriods,
        shot_clock_full_ms: initial.shotClockFullMs,
        shot_clock_remaining_ms: initial.shotClockRemainingMs,
        shot_clock_running: initial.shotClockRunning,
        shot_clock_short_ms: initial.shotClockShortMs,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.toEngineState(game, inserted, null);
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

    if (!access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_SCORE_OVERRIDE)) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('access.game_scorekeeper_assignments as assignments')
            .select('assignments.id')
            .where('assignments.organization_member_id', '=', access.membershipId)
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

    if (!event || !['score.record', 'team_foul.record'].includes(event.type)) {
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
      return `Score +${payload.points ?? ''}`.trim();
    }

    return 'Team foul';
  }

  private toEngineState(
    game: ScheduleGame,
    row: ScoringStateRow,
    latestReversibleEvent: LatestReversibleScoringEvent | null,
  ): ScoringState {
    return {
      awayScore: row.away_score,
      awayTeamFouls: row.away_team_fouls,
      awayTeamId: game.away_team_id,
      currentPeriodNumber: row.current_period_number,
      gameClockRemainingMs: row.game_clock_remaining_ms,
      gameClockRunning: row.game_clock_running,
      gameClockStartedAt: row.game_clock_started_at,
      gameId: game.id,
      homeScore: row.home_score,
      homeTeamFouls: row.home_team_fouls,
      homeTeamId: game.home_team_id,
      latestReversibleEvent,
      overtimeDurationMs: row.overtime_duration_ms,
      overtimeNumber: row.overtime_number,
      periodDurationMs: row.period_duration_ms,
      phase: row.phase as ScoringState['phase'],
      regulationPeriods: row.regulation_periods,
      sequence: row.version,
      shotClockFullMs: row.shot_clock_full_ms,
      shotClockRemainingMs: row.shot_clock_remaining_ms,
      shotClockRunning: row.shot_clock_running,
      shotClockShortMs: row.shot_clock_short_ms,
      shotClockStartedAt: row.shot_clock_started_at,
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
        shotClockFullMs: state.shotClockFullMs,
        shotClockShortMs: state.shotClockShortMs,
      },
      control,
      fouls: {
        away: state.awayTeamFouls,
        home: state.homeTeamFouls,
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
        current_period_number: state.currentPeriodNumber,
        game_clock_remaining_ms: state.gameClockRemainingMs,
        game_clock_running: state.gameClockRunning,
        game_clock_started_at: state.gameClockStartedAt,
        home_score: state.homeScore,
        home_team_fouls: state.homeTeamFouls,
        latest_reversible_event_id: state.latestReversibleEvent
          ? insertedEventId
          : null,
        overtime_number: state.overtimeNumber,
        phase: state.phase,
        shot_clock_remaining_ms: state.shotClockRemainingMs,
        shot_clock_running: state.shotClockRunning,
        shot_clock_started_at: state.shotClockStartedAt,
        updated_at: new Date(),
        version: state.version,
      })
      .where('game_id', '=', gameId)
      .execute();
  }
}
