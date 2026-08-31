import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { Json } from '../../database/db';
import type {
  RecordStatisticEventDto,
  TakeoverStatisticsControlDto,
} from './dto/statistics-command.dto';
import {
  applyStatisticCommand,
  reconcilePlayerPoints,
  type PlayerBoxScore,
  type StatisticEventType,
  type StatisticRecordedEvent,
} from './statistics-engine';
import { suggestPlayerOfGame } from './player-of-game';
import { AUTH_ROLES } from '../../common/auth/roles';
import { OfficialResultCoordinator } from '../official-result/official-result.service';

type StatisticsGameContext = {
  away_score: number | null;
  away_team_id: string;
  home_score: number | null;
  home_team_id: string;
  id: string;
  organization_id: string;
  status: string;
};

type OfficialScoreProjection = {
  awayScore: number | null;
  homeScore: number | null;
  away_score: number | null;
  home_score: number | null;
  phase: string;
  current_period_number: number;
  regulation_periods: number;
  game_clock_remaining_ms: number;
  game_clock_running: boolean;
  shot_clock_running: boolean;
};

@Injectable()
export class StatisticsService {
  private static readonly CONTROL_TTL_MS = 90_000;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly officialResultCoordinator: OfficialResultCoordinator,
  ) {}

  async getState(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    const [sheet, eventRows, boxScoreRows, roster] = await Promise.all([
      this.db
        .selectFrom('statistics.game_stat_sheets')
        .selectAll()
        .where('game_id', '=', gameId)
        .executeTakeFirst(),
      this.db
        .selectFrom('statistics.stat_events')
        .selectAll()
        .where('game_id', '=', gameId)
        .orderBy('sequence asc')
        .execute(),
      this.db
        .selectFrom('statistics.player_box_scores')
        .selectAll()
        .where('game_id', '=', gameId)
        .orderBy('game_roster_player_id asc')
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

    return {
      boxScores: boxScoreRows.map((row) => ({
        assists: row.assists,
        playerId: row.game_roster_player_id,
        points: row.points,
        rebounds: row.rebounds,
        steals: row.steals,
        teamId: row.team_id,
        turnovers: row.turnovers,
      })),
      events: eventRows,
      game: {
        awayScore: game.away_score,
        awayTeamId: game.away_team_id,
        homeScore: game.home_score,
        homeTeamId: game.home_team_id,
        status: game.status,
      },
      roster,
      sheet: sheet ?? {
        away_player_points: 0,
        home_player_points: 0,
        override_reason: null,
        status: 'draft',
        version: 0,
      },
      version: sheet?.version ?? 0,
    };
  }

  async claimControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    deviceLabel?: string,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    const now = new Date();
    const controlToken = randomBytes(32).toString('hex');
    let session: { id: string; expires_at: Date };
    try {
      session = await this.db.transaction().execute(async (trx) => {
        const lockedGame = await this.lockGameForStatistics(
          trx,
          organizationId,
          gameId,
          game,
        );
        await this.lockExistingScoringState(trx, lockedGame.id);
        const active = await this.findActiveControl(
          lockedGame.id,
          trx,
          true,
        );

        if (active && new Date(active.expires_at) > now) {
          throw new ConflictException(
            'Statistics control is active on another device. Use takeover if that device is unavailable.',
          );
        }
        if (active) {
          await trx
            .updateTable('statistics.stat_control_sessions')
            .set({ release_reason: 'expired', released_at: now })
            .where('id', '=', active.id)
            .where('released_at', 'is', null)
            .execute();
        }

        return trx
          .insertInto('statistics.stat_control_sessions')
          .values({
            control_token_hash: this.hashToken(controlToken),
            device_label: deviceLabel,
            expires_at: new Date(
              now.getTime() + StatisticsService.CONTROL_TTL_MS,
            ),
            game_id: lockedGame.id,
            last_heartbeat_at: now,
            organization_member_id: access.membershipId,
          })
          .returning(['expires_at', 'id'])
          .executeTakeFirstOrThrow();
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Statistics control is active on another device. Use takeover if that device is unavailable.',
        );
      }
      throw error;
    }

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
    const game = await this.assertGameAccess(organizationId, gameId, access);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + StatisticsService.CONTROL_TTL_MS,
    );

    return this.db.transaction().execute(async (trx) => {
      const lockedGame = await this.lockGameForStatistics(
        trx,
        organizationId,
        gameId,
        game,
      );
      await this.lockExistingScoringState(trx, lockedGame.id);
      const session = await this.assertControl(
        lockedGame.id,
        access,
        controlToken,
        trx,
        true,
      );
      const result = await trx
        .updateTable('statistics.stat_control_sessions')
        .set({ expires_at: expiresAt, last_heartbeat_at: now })
        .where('id', '=', session.id)
        .where('released_at', 'is', null)
        .execute();
      this.assertSingleRowUpdated(
        result,
        'This statistics control is no longer active. Claim control again.',
      );
      return { expiresAt, sessionId: session.id };
    });
  }

  async takeoverControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: TakeoverStatisticsControlDto,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    const now = new Date();
    const controlToken = randomBytes(32).toString('hex');

    try {
      const result = await this.db.transaction().execute(async (trx) => {
        const lockedGame = await this.lockGameForStatistics(
          trx,
          organizationId,
          gameId,
          game,
        );
        await this.lockExistingScoringState(trx, lockedGame.id);
        const active = await this.findActiveControl(
          lockedGame.id,
          trx,
          true,
        );
        if (active && new Date(active.expires_at) > now) {
          throw new ConflictException(
            'Statistics control is still active on another device. Try again when it is available.',
          );
        }
        if (active) {
          await trx
            .updateTable('statistics.stat_control_sessions')
            .set({
              release_reason: 'takeover',
              released_at: now,
              takeover_reason: dto.reason,
            })
            .where('id', '=', active.id)
            .where('released_at', 'is', null)
            .execute();
        }

        const created = await trx
          .insertInto('statistics.stat_control_sessions')
          .values({
            control_token_hash: this.hashToken(controlToken),
            device_label: dto.deviceLabel,
            expires_at: new Date(
              now.getTime() + StatisticsService.CONTROL_TTL_MS,
            ),
            game_id: lockedGame.id,
            last_heartbeat_at: now,
            organization_member_id: access.membershipId,
          })
          .returning(['expires_at', 'id'])
          .executeTakeFirstOrThrow();

        if (active) {
          await trx
            .updateTable('statistics.stat_control_sessions')
            .set({ taken_over_by_session_id: created.id })
            .where('id', '=', active.id)
            .execute();
        }
        await this.writeAudit(
          access,
          gameId,
          'statistics.control.taken_over',
          { reason: dto.reason },
          trx,
        );
        return {
          active,
          created,
        };
      });

      return {
        controlToken,
        expiresAt: result.created.expires_at,
        sessionId: result.created.id,
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException(
          'Statistics control is still active on another device. Try again when it is available.',
        );
      }
      throw error;
    }
  }

  async releaseControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      const lockedGame = await this.lockGameForStatistics(
        trx,
        organizationId,
        gameId,
        game,
      );
      await this.lockExistingScoringState(trx, lockedGame.id);
      const session = await this.assertControl(
        lockedGame.id,
        access,
        controlToken,
        trx,
        true,
      );
      const result = await trx
        .updateTable('statistics.stat_control_sessions')
        .set({ release_reason: 'released', released_at: now })
        .where('id', '=', session.id)
        .where('released_at', 'is', null)
        .execute();
      this.assertSingleRowUpdated(
        result,
        'This statistics control is no longer active. Claim control again.',
      );
    });
    return { success: true };
  }

  async recordEvent(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: RecordStatisticEventDto,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    await this.db.transaction().execute(async (trx) => {
      const lockedGame = await this.lockGameForStatistics(
        trx,
        organizationId,
        gameId,
        game,
      );
      await this.lockExistingScoringState(trx, lockedGame.id);
      await this.assertGameRosterSnapshots(lockedGame, trx);
      await this.ensureStatSheet(lockedGame, trx);
      const sheet = await trx
        .selectFrom('statistics.game_stat_sheets')
        .selectAll()
        .where('game_id', '=', gameId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await this.assertControl(
        lockedGame.id,
        access,
        dto.controlToken,
        trx,
        true,
      );
      if (!['draft', 'reopened'].includes(sheet.status)) {
        throw new ConflictException(
          'This stat sheet has been submitted. Reopen it before recording corrections.',
        );
      }
      const eventRows = await trx
        .selectFrom('statistics.stat_events')
        .selectAll()
        .where('game_id', '=', gameId)
        .orderBy('sequence asc')
        .execute();
      const events: StatisticRecordedEvent[] = eventRows.map((event) => ({
        id: event.id,
        idempotencyKey: event.idempotency_key,
        playerId: event.game_roster_player_id,
        reversesEventId: event.reverses_event_id,
        sequence: event.sequence,
        teamId: event.team_id,
        type: event.type as StatisticEventType,
        value: event.value,
      }));
      let teamId: string | undefined;
      if (!dto.reversesEventId && dto.playerId) {
        const player = await trx
          .selectFrom('scoring.game_roster_players as players')
          .innerJoin(
            'scoring.game_roster_snapshots as snapshots',
            'snapshots.id',
            'players.game_roster_snapshot_id',
          )
          .select('snapshots.team_id')
          .where('players.id', '=', dto.playerId)
          .where('snapshots.game_id', '=', gameId)
          .executeTakeFirst();
        if (!player) {
          throw new BadRequestException(
            'Choose a player from the published game roster.',
          );
        }
        teamId = player.team_id;
      }

      let result;
      try {
        result = applyStatisticCommand(
          { events, version: sheet.version },
          {
            eventId: randomUUID(),
            expectedVersion: dto.expectedVersion,
            idempotencyKey: dto.idempotencyKey,
            playerId: dto.playerId,
            reversesEventId: dto.reversesEventId,
            teamId,
            type: dto.type,
            value: dto.value,
          },
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'The statistic could not be saved.';
        if (message.includes('another device')) {
          throw new ConflictException(message);
        }
        throw new BadRequestException(message);
      }
      if (result.idempotent) return;

      const recorded = result.events.at(-1);
      if (!recorded) return;
      await trx
        .insertInto('statistics.stat_events')
        .values({
          actor_member_id: access.membershipId,
          game_id: gameId,
          game_roster_player_id: recorded.playerId,
          id: recorded.id,
          idempotency_key: recorded.idempotencyKey,
          occurred_at_client: new Date(dto.occurredAt),
          reverses_event_id: recorded.reversesEventId,
          sequence: recorded.sequence,
          stat_sheet_id: sheet.id,
          team_id: recorded.teamId,
          type: recorded.type,
          value: recorded.value,
        })
        .execute();
      await trx
        .deleteFrom('statistics.player_box_scores')
        .where('game_id', '=', gameId)
        .execute();
      if (result.boxScores.length > 0) {
        await trx
          .insertInto('statistics.player_box_scores')
          .values(
            result.boxScores.map((boxScore) => ({
              assists: boxScore.assists,
              game_id: gameId,
              game_roster_player_id: boxScore.playerId,
              points: boxScore.points,
              rebounds: boxScore.rebounds,
              steals: boxScore.steals,
              team_id: boxScore.teamId,
              turnovers: boxScore.turnovers,
            })),
          )
          .execute();
      }
      await trx
        .updateTable('statistics.game_stat_sheets')
        .set({
            away_player_points: this.teamPoints(
              result.boxScores,
              lockedGame.away_team_id,
            ),
            home_player_points: this.teamPoints(
              result.boxScores,
              lockedGame.home_team_id,
            ),
          updated_at: new Date(),
          version: result.version,
        })
        .where('id', '=', sheet.id)
        .executeTakeFirstOrThrow();
    });

    return this.getState(organizationId, gameId, access);
  }

  async submit(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    return this.db.transaction().execute(async (trx) => {
      const lockedGame = await this.lockGameForStatistics(
        trx,
        organizationId,
        gameId,
        game,
      );
      await this.lockExistingScoringState(trx, lockedGame.id);
      await this.assertGameRosterSnapshots(lockedGame, trx);
      await this.ensureStatSheet(lockedGame, trx);
      const sheet = await trx
        .selectFrom('statistics.game_stat_sheets')
        .selectAll()
        .where('game_id', '=', gameId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      await this.assertControl(
        lockedGame.id,
        access,
        controlToken,
        trx,
        true,
      );
      if (!['draft', 'reopened'].includes(sheet.status)) {
        throw new ConflictException(
          'This stat sheet has already been submitted. Reopen it before submitting another version.',
        );
      }

      const score = await this.findLiveOfficialScore(gameId, trx);
      if (!score || score.away_score === null || score.home_score === null) {
        throw new ConflictException(
          'The scorekeeper must record a team score before player statistics can be submitted.',
        );
      }
      this.assertSubmissionReady(score);
      const boxScoreRows = await trx
        .selectFrom('statistics.player_box_scores')
        .selectAll()
        .where('game_id', '=', gameId)
        .execute();
      const boxScores: PlayerBoxScore[] = boxScoreRows.map((row) => ({
        assists: row.assists,
        playerId: row.game_roster_player_id,
        points: row.points,
        rebounds: row.rebounds,
        steals: row.steals,
        teamId: row.team_id,
        turnovers: row.turnovers,
      }));
      const reconciliation = reconcilePlayerPoints(boxScores, {
        awayScore: score.away_score,
        awayTeamId: lockedGame.away_team_id,
        homeScore: score.home_score,
        homeTeamId: lockedGame.home_team_id,
      });
      if (!reconciliation.reconciled) {
        throw new ConflictException(
          'Player points do not match both official team scores. Correct the stat sheet or request an admin override.',
        );
      }
      const now = new Date();
      const updateResult = await trx
        .updateTable('statistics.game_stat_sheets')
        .set({
          reconciled_at: now,
          status: 'submitted',
          submitted_at: now,
          updated_at: now,
        })
        .where('id', '=', sheet.id)
        .where('status', 'in', ['draft', 'reopened'])
        .execute();
      this.assertSingleRowUpdated(
        updateResult,
        'The stat sheet changed before it could be submitted. Review it and try again.',
      );
      return { reconciliation, status: 'submitted' as const };
    });
  }

  private assertSubmissionReady(projection: OfficialScoreProjection) {
    const complete =
      projection.phase === 'period_break' &&
      projection.current_period_number >= projection.regulation_periods &&
      projection.game_clock_remaining_ms === 0 &&
      !projection.game_clock_running &&
      !projection.shot_clock_running &&
      projection.home_score !== projection.away_score;
    if (!complete) {
      throw new ConflictException(
        'The game must be complete and both clocks stopped before the stat sheet can be submitted.',
      );
    }
  }

  private async findLiveOfficialScore(
    gameId: string,
    db: any = this.db,
  ): Promise<OfficialScoreProjection | null> {
    const state = await db
      .selectFrom('scoring.game_states')
      .select([
        'away_score',
        'home_score',
        'phase',
        'current_period_number',
        'regulation_periods',
        'game_clock_remaining_ms',
        'game_clock_running',
        'shot_clock_running',
      ])
      .where('game_id', '=', gameId)
      .executeTakeFirst();
    return state
      ? {
          ...state,
          awayScore: state.away_score,
          homeScore: state.home_score,
        }
      : null;
  }

  async overrideReconciliation(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    reason: string,
  ) {
    this.assertOverrideAccess(access);
    const game = await this.assertGameAccess(organizationId, gameId, access);
    await this.ensureStatSheet(game);
    const now = new Date();
    await this.db
      .updateTable('statistics.game_stat_sheets')
      .set({
        override_by_member_id: access.membershipId,
        override_reason: reason,
        status: 'submitted',
        submitted_at: now,
        updated_at: now,
      })
      .where('game_id', '=', gameId)
      .executeTakeFirstOrThrow();
    await this.writeAudit(
      access,
      gameId,
      'statistics.reconciliation.overridden',
      {
        reason,
      },
    );
    return { status: 'submitted', overridden: true };
  }

  async reopen(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    reason: string,
  ) {
    this.assertOverrideAccess(access);
    await this.assertGameAccess(organizationId, gameId, access);
    return this.officialResultCoordinator.reopen({
      access,
      gameId,
      organizationId,
      reason,
    });
  }

  async getPlayerOfGame(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    if (game.status !== 'final') {
      throw new ConflictException(
        'Player of the Game can be selected after the official result is finalized.',
      );
    }
    const [sheet, candidates] = await Promise.all([
      this.db
        .selectFrom('statistics.game_stat_sheets')
        .select('status')
        .where('game_id', '=', gameId)
        .executeTakeFirst(),
      this.db
        .selectFrom('statistics.player_box_scores as boxScores')
        .innerJoin(
          'scoring.game_roster_players as players',
          'players.id',
          'boxScores.game_roster_player_id',
        )
        .select([
          'boxScores.assists',
          'boxScores.game_roster_player_id as playerId',
          'players.name as playerName',
          'boxScores.points',
          'boxScores.rebounds',
          'boxScores.steals',
          'boxScores.team_id as teamId',
          'boxScores.turnovers',
        ])
        .where('boxScores.game_id', '=', gameId)
        .execute(),
    ]);
    if (sheet?.status !== 'finalized') {
      throw new ConflictException(
        'Finalize the player stat sheet before selecting Player of the Game.',
      );
    }
    const winningTeamId =
      (game.home_score ?? 0) > (game.away_score ?? 0)
        ? game.home_team_id
        : game.away_team_id;
    const suggestion = suggestPlayerOfGame(candidates, winningTeamId);
    if (!suggestion) {
      throw new ConflictException(
        'Player statistics are required before selecting Player of the Game.',
      );
    }
    const storedAward = await this.db
      .insertInto('statistics.game_awards')
      .values({
        game_id: gameId,
        suggested_player_id: suggestion.playerId,
        suggested_score: suggestion.metricScore,
      })
      .onConflict((conflict) =>
        conflict.column('game_id').doUpdateSet({
          suggested_player_id: suggestion.playerId,
          suggested_score: suggestion.metricScore,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    return {
      award: storedAward,
      candidates,
      suggestion,
    };
  }

  async confirmPlayerOfGame(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    playerId: string,
    reason?: string,
  ) {
    if (
      access.role !== AUTH_ROLES.OWNER &&
      access.role !== AUTH_ROLES.ADMIN &&
      access.role !== AUTH_ROLES.STATISTICIAN
    ) {
      throw new BadRequestException(
        'Only the assigned statistician or a league administrator can confirm Player of the Game.',
      );
    }
    const state = await this.getPlayerOfGame(organizationId, gameId, access);
    if (
      !state.candidates.some((candidate) => candidate.playerId === playerId)
    ) {
      throw new BadRequestException(
        'Choose a player who participated in this game.',
      );
    }
    if (playerId !== state.suggestion.playerId && !reason?.trim()) {
      throw new BadRequestException(
        'Explain why another player was selected instead of the suggested player.',
      );
    }
    const now = new Date();
    const award = await this.db.transaction().execute(async (trx) => {
      const confirmed = await trx
        .updateTable('statistics.game_awards')
        .set({
          confirmation_reason: reason?.trim() ?? null,
          confirmed_at: now,
          confirmed_by_member_id: access.membershipId,
          selected_player_id: playerId,
          updated_at: now,
        })
        .where('game_id', '=', gameId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access.audit_events')
        .values({
          action: 'game.player_of_game.confirmed',
          actor_member_id: access.membershipId,
          metadata: {
            reason: reason?.trim() ?? null,
            selectedPlayerId: playerId,
            suggestedPlayerId: state.suggestion.playerId,
          },
          organization_id: organizationId,
          target_id: gameId,
          target_type: 'game',
        })
        .execute();
      return confirmed;
    });
    return { award, suggestion: state.suggestion };
  }

  private async assertGameAccess(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ): Promise<StatisticsGameContext> {
    const game = await this.db
      .selectFrom('competition.games as games')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'games.league_season_id',
      )
      .select([
        'games.away_score',
        'games.away_team_id',
        'games.home_score',
        'games.home_team_id',
        'games.id',
        'seasons.organization_id',
        'games.status',
      ])
      .where('games.id', '=', gameId)
      .where('seasons.organization_id', '=', organizationId)
      .executeTakeFirst();
    if (!game) throw new NotFoundException('Game not found');

    if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_STATS_OVERRIDE)
    ) {
      const assignment = await this.db
        .selectFrom('access.game_statistician_assignments')
        .select('id')
        .where('game_id', '=', gameId)
        .where('organization_member_id', '=', access.membershipId)
        .executeTakeFirst();
      if (!assignment) {
        throw new NotFoundException('Game statistics assignment not found');
      }
    }
    return game;
  }

  private async ensureStatSheet(
    game: StatisticsGameContext,
    db: any = this.db,
  ): Promise<void> {
    await db
      .insertInto('statistics.game_stat_sheets')
      .values({ game_id: game.id })
      .onConflict((conflict) => conflict.column('game_id').doNothing())
      .execute();
  }

  private async assertGameRosterSnapshots(
    game: StatisticsGameContext,
    db: any = this.db,
  ): Promise<void> {
    const snapshots = await db
      .selectFrom('scoring.game_roster_snapshots')
      .select('team_id')
      .where('game_id', '=', game.id)
      .execute();
    const snapshotTeams = new Set(snapshots.map((snapshot) => snapshot.team_id));
    if (
      snapshotTeams.size !== 2 ||
      ![game.home_team_id, game.away_team_id].every((teamId) =>
        snapshotTeams.has(teamId),
      )
    ) {
      throw new ConflictException(
        'Start the game before recording player statistics. The published game rosters are captured when scoring begins.',
      );
    }
  }

  private async assertControl(
    gameId: string,
    access: OrganizationAccessContext,
    token: string,
    db: any = this.db,
    forUpdate = false,
  ) {
    const session = await this.findActiveControl(gameId, db, forUpdate);
    if (!session || new Date(session.expires_at) <= new Date()) {
      throw new ConflictException(
        'Statistics control has expired. Claim control before continuing.',
      );
    }
    if (
      session.organization_member_id !== access.membershipId ||
      session.control_token_hash !== this.hashToken(token)
    ) {
      throw new ConflictException(
        'This device does not control statistics for this game.',
      );
    }
    return session;
  }

  private async findActiveControl(
    gameId: string,
    db: any = this.db,
    forUpdate = false,
  ) {
    let query = db
      .selectFrom('statistics.stat_control_sessions')
      .selectAll()
      .where('game_id', '=', gameId)
      .where('released_at', 'is', null);
    if (forUpdate && typeof query.forUpdate === 'function') {
      query = query.forUpdate();
    }
    return query.executeTakeFirst();
  }

  private async lockGameForStatistics(
    db: any,
    organizationId: string,
    gameId: string,
    fallbackGame?: StatisticsGameContext,
  ): Promise<StatisticsGameContext> {
    const lockedGame = await db
      .selectFrom('competition.games as games')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'games.league_season_id',
      )
      .select([
        'games.away_score as away_score',
        'games.away_team_id as away_team_id',
        'games.home_score as home_score',
        'games.home_team_id as home_team_id',
        'games.id as id',
        'seasons.organization_id as organization_id',
        'games.status as status',
      ])
      .where('games.id', '=', gameId)
      .where('seasons.organization_id', '=', organizationId)
      .forUpdate()
      .executeTakeFirst();
    if (!lockedGame) throw new NotFoundException('Game not found');
    return { ...(fallbackGame ?? {}), ...lockedGame } as StatisticsGameContext;
  }

  private async lockExistingScoringState(db: any, gameId: string) {
    let query = db
      .selectFrom('scoring.game_states')
      .select(['game_id'])
      .where('game_id', '=', gameId);
    if (typeof query.forUpdate === 'function') {
      query = query.forUpdate();
    }
    return query.executeTakeFirst();
  }

  private assertSingleRowUpdated(result: any, message: string): void {
    if (
      result?.numUpdatedRows !== undefined &&
      Number(result.numUpdatedRows) !== 1
    ) {
      throw new ConflictException(message);
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private teamPoints(boxScores: PlayerBoxScore[], teamId: string): number {
    return boxScores
      .filter((boxScore) => boxScore.teamId === teamId)
      .reduce((total, boxScore) => total + boxScore.points, 0);
  }

  private assertOverrideAccess(access: OrganizationAccessContext): void {
    if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.GAME_STATS_OVERRIDE)
    ) {
      throw new NotFoundException('Game statistics assignment not found');
    }
  }

  private async writeAudit(
    access: OrganizationAccessContext,
    gameId: string,
    action: string,
    metadata: Json,
    db: any = this.db,
  ) {
    await db
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
}
