import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import { NotificationWriter } from '../notification/notification.writer';
import { calculateRankedStandings } from '../standings/standings-calculator';
import type {
  FinalizedGameResult,
  ManualTieDecision,
  StandingsTeam,
  TiebreakerRule,
} from '../standings/standings.types';
import {
  assertOfficialResultScore,
  assertStatisticsGate,
  OfficialResultPolicyError,
  planMatchupProgression,
} from './official-result.policy';

export type OfficialResultSource = 'manual' | 'scorekeeper';

export type FinalizeOfficialResultInput = {
  access: OrganizationAccessContext;
  awayScore: number;
  gameId: string;
  homeScore: number;
  organizationId: string;
  source: OfficialResultSource;
};

type OfficialGame = {
  away_score: number | null;
  away_team_id: string;
  competition_kind: string;
  division_id: string;
  home_score: number | null;
  home_team_id: string;
  id: string;
  league_season_id: string;
  matchup_id: string | null;
  status: string;
};

@Injectable()
export class OfficialResultCoordinator {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notificationWriter: NotificationWriter,
  ) {}

  finalize(input: FinalizeOfficialResultInput) {
    return this.db.transaction().execute((trx) =>
      this.finalizeInTransaction(trx, input),
    );
  }

  recalculateDivision(
    organizationId: string,
    divisionId: string,
    access: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const format = await trx
        .selectFrom('competition.division_formats')
        .selectAll()
        .where('division_id', '=', divisionId)
        .executeTakeFirstOrThrow();
      const game = await trx
        .selectFrom('competition.games')
        .select([
          'away_score',
          'away_team_id',
          'competition_kind',
          'division_id',
          'home_score',
          'home_team_id',
          'id',
          'league_season_id',
          'matchup_id',
          'status',
        ])
        .where('division_id', '=', divisionId)
        .where('status', '=', 'final')
        .orderBy('finalized_at desc')
        .executeTakeFirst();
      if (!game) {
        throw new ConflictException(
          'Finalized pool games are required before standings can be recalculated.',
        );
      }
      await this.rebuildPoolStandings(trx, format, game, {
        access,
        awayScore: game.away_score ?? 0,
        gameId: game.id,
        homeScore: game.home_score ?? 0,
        organizationId,
        source: 'manual',
      });
      return { success: true };
    });
  }

  async finalizeInTransaction(db: any, input: FinalizeOfficialResultInput) {
    try {
      assertOfficialResultScore(input.homeScore, input.awayScore);
    } catch (error) {
      if (error instanceof OfficialResultPolicyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const game = await this.findGameForUpdate(db, input);
    if (game.status === 'final') {
      if (
        game.home_score === input.homeScore &&
        game.away_score === input.awayScore
      ) {
        return { alreadyFinalized: true, gameId: game.id };
      }
      throw new ConflictException(
        'This game already has a different official result. Reopen it before recording a correction.',
      );
    }
    this.assertSourceCanFinalize(game, input.source);
    await this.assertRosterAndStatisticsGate(db, game, input);

    const now = new Date();
    await db
      .updateTable('competition.games')
      .set({
        away_score: input.awayScore,
        finalized_at: now,
        home_score: input.homeScore,
        status: 'final',
        updated_at: now,
      })
      .where('id', '=', game.id)
      .executeTakeFirstOrThrow();

    await db
      .updateTable('statistics.game_stat_sheets')
      .set({ finalized_at: now, status: 'finalized', updated_at: now })
      .where('game_id', '=', game.id)
      .where('status', '=', 'submitted')
      .execute();

    await db
      .insertInto('access.audit_events')
      .values({
        action:
          input.source === 'manual'
            ? 'game.manually_finalized'
            : 'game.finalized',
        actor_member_id: input.access.membershipId,
        metadata: {
          awayScore: input.awayScore,
          homeScore: input.homeScore,
          previousStatus: game.status,
          source: input.source,
        },
        organization_id: input.organizationId,
        target_id: game.id,
        target_type: 'game',
      })
      .execute();

    const competition =
      game.competition_kind === 'exhibition'
        ? { championTeamId: null, standingsRebuilt: false }
        : await this.rebuildCompetition(db, game, input);
    await this.writeResultNotification(db, game, input);

    return {
      alreadyFinalized: false,
      gameId: game.id,
      ...competition,
    };
  }

  private async findGameForUpdate(
    db: any,
    input: FinalizeOfficialResultInput,
  ): Promise<OfficialGame> {
    const game = await db
      .selectFrom('competition.games as games')
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'games.league_season_id',
      )
      .select([
        'games.away_score',
        'games.away_team_id',
        'games.competition_kind',
        'games.division_id',
        'games.home_score',
        'games.home_team_id',
        'games.id',
        'games.league_season_id',
        'games.matchup_id',
        'games.status',
      ])
      .where('games.id', '=', input.gameId)
      .where('seasons.organization_id', '=', input.organizationId)
      .forUpdate()
      .executeTakeFirst();
    if (!game) throw new NotFoundException('Schedule game not found');
    return game;
  }

  private assertSourceCanFinalize(
    game: OfficialGame,
    source: OfficialResultSource,
  ) {
    const allowed =
      source === 'manual'
        ? game.status === 'scheduled'
        : ['live', 'reopened'].includes(game.status);
    if (!allowed) {
      throw new ConflictException(
        source === 'manual'
          ? 'Only scheduled games can be finalized from Schedules.'
          : 'This game is not ready to be finalized from the scorekeeper console.',
      );
    }
  }

  private async assertRosterAndStatisticsGate(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    if (input.source === 'scorekeeper') {
      const snapshots = await db
        .selectFrom('scoring.game_roster_snapshots')
        .select('team_id')
        .where('game_id', '=', game.id)
        .execute();
      if (new Set(snapshots.map((row: { team_id: string }) => row.team_id)).size !== 2) {
        throw new ConflictException(
          'Both published game rosters are required before this result can be finalized.',
        );
      }
    }

    const assignment = await db
      .selectFrom('access.game_statistician_assignments')
      .select('id')
      .where('game_id', '=', game.id)
      .executeTakeFirst();
    const sheet = assignment
      ? await db
          .selectFrom('statistics.game_stat_sheets')
          .select([
            'away_player_points',
            'home_player_points',
            'override_reason',
            'status',
          ])
          .where('game_id', '=', game.id)
          .executeTakeFirst()
      : null;
    try {
      assertStatisticsGate(
        sheet
          ? {
              awayPlayerPoints: sheet.away_player_points,
              homePlayerPoints: sheet.home_player_points,
              overrideReason: sheet.override_reason,
              status: sheet.status,
            }
          : null,
        { awayScore: input.awayScore, homeScore: input.homeScore },
        Boolean(assignment),
      );
    } catch (error) {
      if (error instanceof OfficialResultPolicyError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  private async rebuildCompetition(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    const format = await db
      .selectFrom('competition.division_formats')
      .selectAll()
      .where('division_id', '=', game.division_id)
      .executeTakeFirst();
    if (!format) return { championTeamId: null, standingsRebuilt: false };

    let championTeamId: string | null = null;
    if (game.matchup_id) {
      championTeamId = await this.completeAndAdvanceMatchup(
        db,
        game,
        input,
      );
    }
    await this.rebuildPoolStandings(db, format, game, input);
    return { championTeamId, standingsRebuilt: true };
  }

  private async completeAndAdvanceMatchup(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ): Promise<string | null> {
    const matchup = await db
      .selectFrom('competition.matchups')
      .selectAll()
      .where('id', '=', game.matchup_id)
      .forUpdate()
      .executeTakeFirst();
    if (!matchup) return null;
    const winnerTeamId =
      input.homeScore > input.awayScore
        ? game.home_team_id
        : game.away_team_id;
    const loserTeamId =
      winnerTeamId === game.home_team_id
        ? game.away_team_id
        : game.home_team_id;
    await db
      .updateTable('competition.matchups')
      .set({
        loser_team_id: loserTeamId,
        status: 'final',
        updated_at: new Date(),
        winner_team_id: winnerTeamId,
      })
      .where('id', '=', matchup.id)
      .executeTakeFirstOrThrow();
    if (matchup.stage !== 'playoff') return null;

    const plan = planMatchupProgression(
      {
        awayTeamId: matchup.away_team_id,
        bracketSide: matchup.bracket_side,
        homeTeamId: matchup.home_team_id,
        id: matchup.id,
        isResetFinal: matchup.is_reset_final,
        loserToMatchupId: matchup.loser_to_matchup_id,
        loserToSlot: matchup.loser_to_slot,
        winnerToMatchupId: matchup.winner_to_matchup_id,
        winnerToSlot: matchup.winner_to_slot,
      },
      winnerTeamId,
      loserTeamId,
    );
    for (const target of plan.targetSlots) {
      const column = target.slot === 'home' ? 'home_team_id' : 'away_team_id';
      await db
        .updateTable('competition.matchups')
        .set({ [column]: target.teamId, updated_at: new Date() })
        .where('id', '=', target.matchupId)
        .executeTakeFirstOrThrow();
      await db
        .updateTable('competition.matchups')
        .set({ status: 'ready', updated_at: new Date() })
        .where('id', '=', target.matchupId)
        .where('home_team_id', 'is not', null)
        .where('away_team_id', 'is not', null)
        .execute();
    }
    if (plan.voidMatchupIds.length > 0) {
      await db
        .updateTable('competition.matchups')
        .set({ status: 'void', updated_at: new Date() })
        .where('id', 'in', plan.voidMatchupIds)
        .execute();
    }
    if (plan.championTeamId) {
      await db
        .updateTable('competition.division_formats')
        .set({ status: 'completed', updated_at: new Date() })
        .where('id', '=', matchup.division_format_id)
        .execute();
    }
    await this.writeProgressionNotifications(
      db,
      game,
      input,
      winnerTeamId,
      plan.eliminatedTeamIds,
      plan.championTeamId,
    );
    return plan.championTeamId;
  }

  private async rebuildPoolStandings(
    db: any,
    format: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    const pools = await db
      .selectFrom('competition.pools')
      .select(['code', 'id'])
      .where('division_format_id', '=', format.id)
      .orderBy('sort_order asc')
      .execute();
    if (pools.length === 0) return;

    await db
      .deleteFrom('competition.standings_projections')
      .where('division_format_id', '=', format.id)
      .execute();
    let allPoolsComplete = true;
    let hasUnresolvedTies = false;
    const qualifiedBySeed = new Map<string, string>();

    for (const pool of pools) {
      const teams = (await db
        .selectFrom('competition.pool_teams as poolTeams')
        .innerJoin('admin.teams as teams', 'teams.id', 'poolTeams.team_id')
        .innerJoin(
          'admin.divisions as divisions',
          'divisions.id',
          'teams.division_id',
        )
        .select([
          'teams.color',
          'divisions.id as division_id',
          'divisions.name as division_name',
          'teams.id',
          'teams.name',
        ])
        .where('poolTeams.pool_id', '=', pool.id)
        .execute()) as StandingsTeam[];
      const results = (await db
        .selectFrom('competition.games as games')
        .innerJoin(
          'competition.matchups as matchups',
          'matchups.id',
          'games.matchup_id',
        )
        .select([
          'games.away_score',
          'games.away_team_id',
          'games.division_id',
          'games.home_score',
          'games.home_team_id',
          'games.id',
          'games.starts_at',
        ])
        .where('matchups.pool_id', '=', pool.id)
        .where('games.status', '=', 'final')
        .where('games.competition_kind', '!=', 'exhibition')
        .execute()) as FinalizedGameResult[];
      const decisions = (await db
        .selectFrom('competition.tie_decisions')
        .select(['ordered_team_ids', 'team_ids'])
        .where('division_format_id', '=', format.id)
        .where('pool_id', '=', pool.id)
        .execute()).map(
        (decision: { ordered_team_ids: unknown; team_ids: unknown }) => ({
          orderedTeamIds: decision.ordered_team_ids as string[],
          teamIds: decision.team_ids as string[],
        }),
      ) as ManualTieDecision[];
      const ranked = calculateRankedStandings(
        teams,
        results,
        format.tiebreakers as TiebreakerRule[],
        decisions,
      );
      const required = await db
        .selectFrom('competition.matchups')
        .select(['id', 'status'])
        .where('pool_id', '=', pool.id)
        .where('stage', '=', 'qualifier')
        .execute();
      const poolComplete =
        required.length > 0 &&
        required.every((matchup: { status: string }) => matchup.status === 'final');
      allPoolsComplete = allPoolsComplete && poolComplete;
      hasUnresolvedTies = hasUnresolvedTies || ranked.unresolvedTies.length > 0;

      if (ranked.rows.length > 0) {
        await db
          .insertInto('competition.standings_projections')
          .values(
            ranked.rows.map((row) => ({
              division_format_id: format.id,
              games_played: row.gamesPlayed,
              losses: row.losses,
              point_differential: row.pointDifferential,
              points_against: row.pointsAgainst,
              points_for: row.pointsFor,
              pool_id: pool.id,
              qualification_status:
                poolComplete &&
                !row.unresolvedTieKey &&
                row.rank !== null &&
                row.rank <= format.qualifiers_per_pool
                  ? 'qualified'
                  : poolComplete && !row.unresolvedTieKey
                    ? 'eliminated'
                    : 'pending',
              rank: row.rank,
              ranking_explanation: row.rankingExplanation,
              team_id: row.teamId,
              version: 1,
            })),
          )
          .execute();
      }
      if (poolComplete && ranked.unresolvedTies.length === 0) {
        for (const row of ranked.rows) {
          if (row.rank && row.rank <= format.qualifiers_per_pool) {
            qualifiedBySeed.set(`${pool.code}${row.rank}`, row.teamId);
          }
        }
      }
    }

    if (allPoolsComplete && !hasUnresolvedTies) {
      await this.fillQualifiedPlayoffSlots(db, format.id, qualifiedBySeed);
      await this.writeQualificationNotification(db, game, input);
    } else if (hasUnresolvedTies) {
      await this.writeTieNotification(db, game, input);
    }
  }

  private async fillQualifiedPlayoffSlots(
    db: any,
    formatId: string,
    qualifiedBySeed: Map<string, string>,
  ) {
    const matchups = await db
      .selectFrom('competition.matchups')
      .selectAll()
      .where('division_format_id', '=', formatId)
      .where('stage', '=', 'playoff')
      .execute();
    for (const matchup of matchups) {
      const values: Record<string, unknown> = { updated_at: new Date() };
      if (matchup.home_source_type === 'pool_seed' && matchup.home_source_ref) {
        values.home_team_id = qualifiedBySeed.get(matchup.home_source_ref) ?? null;
      }
      if (matchup.away_source_type === 'pool_seed' && matchup.away_source_ref) {
        values.away_team_id = qualifiedBySeed.get(matchup.away_source_ref) ?? null;
      }
      await db
        .updateTable('competition.matchups')
        .set(values)
        .where('id', '=', matchup.id)
        .execute();
      await db
        .updateTable('competition.matchups')
        .set({ status: 'ready', updated_at: new Date() })
        .where('id', '=', matchup.id)
        .where('home_team_id', 'is not', null)
        .where('away_team_id', 'is not', null)
        .execute();
    }
  }

  private async writeResultNotification(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    const context = await this.notificationContext(db, input.organizationId);
    await this.notificationWriter.create(
      {
        actorUserId: input.access.userId,
        context: {
          ...context,
          gameId: game.id,
          resultLabel: `${input.homeScore}–${input.awayScore}`,
        },
        dedupeKey: `official-result:${game.id}`,
        eventType: 'scoring.game_finalized',
        organizationId: input.organizationId,
        recipients: await this.organizationStaffRecipients(
          db,
          input.organizationId,
        ),
        resourceId: game.id,
        resourceType: 'game',
      },
      db,
    );
  }

  private async writeQualificationNotification(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    await this.writeCompetitionNotification(
      db,
      game,
      input,
      'playoffs.qualification_confirmed',
      `qualification:${game.division_id}`,
    );
  }

  private async writeTieNotification(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
  ) {
    await this.writeCompetitionNotification(
      db,
      game,
      input,
      'standings.tie_requires_decision',
      `tie:${game.division_id}`,
    );
  }

  private async writeProgressionNotifications(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
    winnerTeamId: string,
    eliminatedTeamIds: string[],
    championTeamId: string | null,
  ) {
    await this.writeCompetitionNotification(
      db,
      game,
      input,
      'playoffs.team_advanced',
      `advance:${game.id}:${winnerTeamId}`,
    );
    for (const teamId of eliminatedTeamIds) {
      await this.writeCompetitionNotification(
        db,
        game,
        input,
        'playoffs.team_eliminated',
        `eliminated:${game.id}:${teamId}`,
      );
    }
    if (championTeamId) {
      await this.writeCompetitionNotification(
        db,
        game,
        input,
        'playoffs.champion_confirmed',
        `champion:${game.division_id}:${championTeamId}`,
      );
    }
  }

  private async writeCompetitionNotification(
    db: any,
    game: OfficialGame,
    input: FinalizeOfficialResultInput,
    eventType:
      | 'playoffs.champion_confirmed'
      | 'playoffs.qualification_confirmed'
      | 'playoffs.team_advanced'
      | 'playoffs.team_eliminated'
      | 'standings.tie_requires_decision',
    dedupeKey: string,
  ) {
    await this.notificationWriter.create(
      {
        actorUserId: input.access.userId,
        context: await this.notificationContext(db, input.organizationId),
        dedupeKey,
        eventType,
        organizationId: input.organizationId,
        recipients: await this.organizationStaffRecipients(
          db,
          input.organizationId,
        ),
        resourceId: game.division_id,
        resourceType: 'division',
      },
      db,
    );
  }

  private async notificationContext(db: any, organizationId: string) {
    const organization = await db
      .selectFrom('admin.organizations')
      .select(['name', 'slug'])
      .where('id', '=', organizationId)
      .executeTakeFirstOrThrow();
    return {
      organizationName: organization.name,
      organizationSlug: organization.slug,
    };
  }

  private async organizationStaffRecipients(db: any, organizationId: string) {
    return db
      .selectFrom('admin.organization_members as members')
      .innerJoin('auth.users as users', 'users.id', 'members.user_id')
      .select(['users.email', 'users.id as userId'])
      .where('members.organization_id', '=', organizationId)
      .where('members.status', '=', 'active')
      .where('members.role', 'in', ['owner', 'admin'])
      .execute();
  }
}
