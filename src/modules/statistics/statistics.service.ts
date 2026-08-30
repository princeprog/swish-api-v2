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

type StatisticsGameContext = {
  away_score: number | null;
  away_team_id: string;
  home_score: number | null;
  home_team_id: string;
  id: string;
  organization_id: string;
  status: string;
};

@Injectable()
export class StatisticsService {
  private static readonly CONTROL_TTL_MS = 90_000;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getState(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    await this.ensureRosterAndSheet(game);
    const [sheet, eventRows, boxScoreRows, roster] = await Promise.all([
      this.db
        .selectFrom('statistics.game_stat_sheets')
        .selectAll()
        .where('game_id', '=', gameId)
        .executeTakeFirstOrThrow(),
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
      sheet,
      version: sheet.version,
    };
  }

  async claimControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    deviceLabel?: string,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    await this.ensureRosterAndSheet(game);
    const now = new Date();
    const active = await this.db
      .selectFrom('statistics.stat_control_sessions')
      .selectAll()
      .where('game_id', '=', gameId)
      .where('released_at', 'is', null)
      .executeTakeFirst();

    if (active && new Date(active.expires_at) > now) {
      throw new ConflictException(
        'Statistics control is active on another device. Use takeover if that device is unavailable.',
      );
    }
    if (active) {
      await this.db
        .updateTable('statistics.stat_control_sessions')
        .set({ release_reason: 'expired', released_at: now })
        .where('id', '=', active.id)
        .execute();
    }

    const controlToken = randomBytes(32).toString('hex');
    const session = await this.db
      .insertInto('statistics.stat_control_sessions')
      .values({
        control_token_hash: this.hashToken(controlToken),
        device_label: deviceLabel,
        expires_at: new Date(now.getTime() + StatisticsService.CONTROL_TTL_MS),
        game_id: gameId,
        last_heartbeat_at: now,
        organization_member_id: access.membershipId,
      })
      .returning(['expires_at', 'id'])
      .executeTakeFirstOrThrow();

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
    await this.assertGameAccess(organizationId, gameId, access);
    const session = await this.assertControl(gameId, access, controlToken);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + StatisticsService.CONTROL_TTL_MS,
    );
    await this.db
      .updateTable('statistics.stat_control_sessions')
      .set({ expires_at: expiresAt, last_heartbeat_at: now })
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow();
    return { expiresAt, sessionId: session.id };
  }

  async takeoverControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: TakeoverStatisticsControlDto,
  ) {
    await this.assertGameAccess(organizationId, gameId, access);
    const active = await this.db
      .selectFrom('statistics.stat_control_sessions')
      .select('id')
      .where('game_id', '=', gameId)
      .where('released_at', 'is', null)
      .executeTakeFirst();
    if (active) {
      await this.db
        .updateTable('statistics.stat_control_sessions')
        .set({
          release_reason: 'takeover',
          released_at: new Date(),
          takeover_reason: dto.reason,
        })
        .where('id', '=', active.id)
        .execute();
    }
    const claimed = await this.claimControl(
      organizationId,
      gameId,
      access,
      dto.deviceLabel,
    );
    if (active) {
      await this.db
        .updateTable('statistics.stat_control_sessions')
        .set({ taken_over_by_session_id: claimed.sessionId })
        .where('id', '=', active.id)
        .execute();
    }
    await this.writeAudit(access, gameId, 'statistics.control.taken_over', {
      reason: dto.reason,
    });
    return claimed;
  }

  async releaseControl(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    controlToken: string,
  ) {
    await this.assertGameAccess(organizationId, gameId, access);
    const session = await this.assertControl(gameId, access, controlToken);
    await this.db
      .updateTable('statistics.stat_control_sessions')
      .set({ release_reason: 'released', released_at: new Date() })
      .where('id', '=', session.id)
      .executeTakeFirstOrThrow();
    return { success: true };
  }

  async recordEvent(
    organizationId: string,
    gameId: string,
    access: OrganizationAccessContext,
    dto: RecordStatisticEventDto,
  ) {
    const game = await this.assertGameAccess(organizationId, gameId, access);
    await this.ensureRosterAndSheet(game);
    await this.assertControl(gameId, access, dto.controlToken);

    await this.db.transaction().execute(async (trx) => {
      const sheet = await trx
        .selectFrom('statistics.game_stat_sheets')
        .selectAll()
        .where('game_id', '=', gameId)
        .forUpdate()
        .executeTakeFirstOrThrow();
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
            game.away_team_id,
          ),
          home_player_points: this.teamPoints(
            result.boxScores,
            game.home_team_id,
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
    await this.assertControl(gameId, access, controlToken);
    const score =
      game.home_score !== null && game.away_score !== null
        ? { awayScore: game.away_score, homeScore: game.home_score }
        : await this.findLiveOfficialScore(gameId);
    if (!score) {
      throw new ConflictException(
        'The scorekeeper must record a team score before player statistics can be submitted.',
      );
    }
    const state = await this.getState(organizationId, gameId, access);
    const reconciliation = reconcilePlayerPoints(state.boxScores, {
      awayScore: score.awayScore,
      awayTeamId: game.away_team_id,
      homeScore: score.homeScore,
      homeTeamId: game.home_team_id,
    });
    if (!reconciliation.reconciled) {
      throw new ConflictException(
        'Player points do not match both official team scores. Correct the stat sheet or request an admin override.',
      );
    }
    const now = new Date();
    await this.db
      .updateTable('statistics.game_stat_sheets')
      .set({
        reconciled_at: now,
        status: 'submitted',
        submitted_at: now,
        updated_at: now,
      })
      .where('game_id', '=', gameId)
      .executeTakeFirstOrThrow();
    return { reconciliation, status: 'submitted' };
  }

  private async findLiveOfficialScore(gameId: string) {
    const state = await this.db
      .selectFrom('scoring.game_states')
      .select(['away_score', 'home_score'])
      .where('game_id', '=', gameId)
      .executeTakeFirst();
    return state
      ? { awayScore: state.away_score, homeScore: state.home_score }
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
    await this.ensureRosterAndSheet(game);
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
    await this.writeAudit(access, gameId, 'statistics.reconciliation.overridden', {
      reason,
    });
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
    const now = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('statistics.game_stat_sheets')
        .set({
          finalized_at: null,
          reconciled_at: null,
          reopened_at: now,
          status: 'reopened',
          updated_at: now,
        })
        .where('game_id', '=', gameId)
        .executeTakeFirstOrThrow();
      await trx
        .updateTable('statistics.game_awards')
        .set({
          confirmation_reason: null,
          confirmed_at: null,
          confirmed_by_member_id: null,
          selected_player_id: null,
          updated_at: now,
        })
        .where('game_id', '=', gameId)
        .execute();
      await trx
        .insertInto('access.audit_events')
        .values({
          action: 'statistics.sheet.reopened',
          actor_member_id: access.membershipId,
          metadata: { reason },
          organization_id: access.organizationId,
          target_id: gameId,
          target_type: 'game',
        })
        .execute();
    });
    return { status: 'reopened' };
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
    if (!state.candidates.some((candidate) => candidate.playerId === playerId)) {
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

  private async ensureRosterAndSheet(game: StatisticsGameContext): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('statistics.game_stat_sheets')
        .values({ game_id: game.id })
        .onConflict((conflict) => conflict.column('game_id').doNothing())
        .execute();
      const existing = await trx
        .selectFrom('scoring.game_roster_snapshots')
        .select(['id', 'team_id'])
        .where('game_id', '=', game.id)
        .execute();
      const existingTeams = new Set(existing.map((row) => row.team_id));

      for (const teamId of [game.home_team_id, game.away_team_id]) {
        if (existingTeams.has(teamId)) continue;
        const roster = await trx
          .selectFrom('admin.team_rosters')
          .select('published_version_id')
          .where('team_id', '=', teamId)
          .executeTakeFirst();
        if (!roster?.published_version_id) {
          throw new ConflictException(
            'Publish both team rosters before opening game statistics.',
          );
        }
        const players = await trx
          .selectFrom('admin.roster_version_players')
          .selectAll()
          .where('roster_version_id', '=', roster.published_version_id)
          .orderBy('sort_order asc')
          .execute();
        const snapshot = await trx
          .insertInto('scoring.game_roster_snapshots')
          .values({
            game_id: game.id,
            source_roster_version_id: roster.published_version_id,
            team_id: teamId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (players.length > 0) {
          await trx
            .insertInto('scoring.game_roster_players')
            .values(
              players.map((player) => ({
                game_roster_snapshot_id: snapshot.id,
                jersey_number: player.jersey_number,
                name: player.name,
                position: player.position,
                sort_order: player.sort_order,
                source_player_id: player.source_player_id,
              })),
            )
            .execute();
        }
      }
    });
  }

  private async assertControl(
    gameId: string,
    access: OrganizationAccessContext,
    token: string,
  ) {
    const session = await this.db
      .selectFrom('statistics.stat_control_sessions')
      .selectAll()
      .where('game_id', '=', gameId)
      .where('organization_member_id', '=', access.membershipId)
      .where('control_token_hash', '=', this.hashToken(token))
      .where('released_at', 'is', null)
      .executeTakeFirst();
    if (!session || new Date(session.expires_at) <= new Date()) {
      throw new ConflictException(
        'Statistics control has expired. Claim control before continuing.',
      );
    }
    return session;
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
  ) {
    await this.db
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
