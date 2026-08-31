import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { jest } from '@jest/globals';
import type { Transaction } from 'kysely';
import { DatabaseService } from '../src/database/database.module';
import type { DB } from '../src/database/db';
import {
  AUTH_ROLES,
  getPermissionsForOrganizationRole,
  type OrganizationAccessContext,
} from '../src/common/auth/roles';
import {
  buildCompetitionPlan,
  type CompetitionPlanMatchup,
} from '../src/modules/competition/competition-plan.builder';
import { resolveGeneratedByes } from '../src/modules/competition/bye-progression';
import { OfficialResultCoordinator } from '../src/modules/official-result/official-result.service';
import { StatisticsService } from '../src/modules/statistics/statistics.service';
import { PublicService } from '../src/modules/public/public.service';

jest.setTimeout(60_000);

type Trx = Transaction<DB>;
type RosterSeed = {
  playerId: string;
  playerName: string;
  rosterVersionId: string;
};

class PilotRollback<T> extends Error {
  constructor(readonly result: T) {
    super('Rollback completed MVP pilot fixtures.');
  }
}

async function rollbackPilot<T>(
  database: DatabaseService['db'],
  run: (trx: Trx) => Promise<T>,
): Promise<T> {
  try {
    await database.transaction().execute(async (trx) => {
      throw new PilotRollback(await run(trx));
    });
  } catch (error) {
    if (error instanceof PilotRollback) return error.result as T;
    throw error;
  }
  throw new Error('Pilot transaction did not roll back as expected.');
}

function reusePilotTransaction(trx: Trx) {
  return new Proxy(trx as any, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return () => ({
          execute: (run: (inner: Trx) => unknown) => run(target),
        });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function insertPlan(
  trx: Trx,
  formatId: string,
  plan: CompetitionPlanMatchup[],
) {
  const db = trx as any;
  const idsByKey = new Map(plan.map((matchup) => [matchup.key, randomUUID()]));
  const resolvedByKey = new Map(
    resolveGeneratedByes(plan).map((matchup) => [matchup.key, matchup]),
  );
  const sourceRef = (type: string, ref: string | null) =>
    ref && ['matchup_winner', 'matchup_loser'].includes(type)
      ? (idsByKey.get(ref) ?? ref)
      : ref;

  await db
    .insertInto('competition.matchups')
    .values(
      plan.map((matchup) => {
        const resolved = resolvedByKey.get(matchup.key)!;
        return {
          away_source_ref: sourceRef(
            matchup.awaySource.type,
            matchup.awaySource.ref,
          ),
          away_source_type: matchup.awaySource.type,
          away_team_id: resolved.awayTeamId,
          bracket_side: matchup.bracketSide,
          division_format_id: formatId,
          format_revision: 1,
          home_source_ref: sourceRef(
            matchup.homeSource.type,
            matchup.homeSource.ref,
          ),
          home_source_type: matchup.homeSource.type,
          home_team_id: resolved.homeTeamId,
          id: idsByKey.get(matchup.key),
          is_reset_final: matchup.isResetFinal,
          label: matchup.label,
          loser_team_id: resolved.loserTeamId,
          pool_id: matchup.poolId,
          position: matchup.position,
          round_number: matchup.roundNumber,
          stage: matchup.stage,
          status: resolved.status,
          winner_team_id: resolved.winnerTeamId,
        };
      }),
    )
    .execute();

  for (const matchup of plan) {
    await db
      .updateTable('competition.matchups')
      .set({
        loser_to_matchup_id: matchup.loserTo
          ? idsByKey.get(matchup.loserTo.matchupKey)
          : null,
        loser_to_slot: matchup.loserTo?.slot ?? null,
        winner_to_matchup_id: matchup.winnerTo
          ? idsByKey.get(matchup.winnerTo.matchupKey)
          : null,
        winner_to_slot: matchup.winnerTo?.slot ?? null,
      })
      .where('id', '=', idsByKey.get(matchup.key))
      .execute();
  }
  return idsByKey;
}

async function seedPublishedRosters(
  trx: Trx,
  teamIds: string[],
  adminMemberId: string,
  labelByTeamId: Map<string, string>,
) {
  const db = trx as any;
  const rosters = new Map<string, RosterSeed>();
  for (const [index, teamId] of teamIds.entries()) {
    const teamLabel = labelByTeamId.get(teamId) ?? `Team ${index + 1}`;
    const player = await db
      .insertInto('admin.players')
      .values({
        jersey_number: String(index + 1),
        name: `${teamLabel} Captain`,
        position: 'Guard',
        team_id: teamId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const teamRoster = await db
      .insertInto('admin.team_rosters')
      .values({ team_id: teamId })
      .returning('id')
      .executeTakeFirstOrThrow();
    const version = await db
      .insertInto('admin.roster_versions')
      .values({
        approved_by_member_id: adminMemberId,
        team_roster_id: teamRoster.id,
        version_number: 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('admin.roster_version_players')
      .values({
        jersey_number: String(index + 1),
        name: `${teamLabel} Captain`,
        position: 'Guard',
        roster_version_id: version.id,
        sort_order: 1,
        source_player_id: player.id,
      })
      .execute();
    await db
      .updateTable('admin.team_rosters')
      .set({
        latest_approved_version_id: version.id,
        published_at: new Date(),
        published_version_id: version.id,
        workflow_status: 'published',
      })
      .where('id', '=', teamRoster.id)
      .execute();
    rosters.set(teamId, {
      playerId: player.id,
      playerName: `${teamLabel} Captain`,
      rosterVersionId: version.id,
    });
  }
  return rosters;
}

async function prepareScoredGame(
  trx: Trx,
  input: {
    awayScore: number;
    awayTeamId: string;
    divisionId: string;
    homeScore: number;
    homeTeamId: string;
    matchupId: string;
    rosterByTeamId: Map<string, RosterSeed>;
    scorekeeperMemberId: string;
    seasonId: string;
    sequence: number;
    statisticianMemberId: string;
    venueId: string;
  },
) {
  const db = trx as any;
  const game = await db
    .insertInto('competition.games')
    .values({
      away_team_id: input.awayTeamId,
      competition_kind: 'stage',
      division_id: input.divisionId,
      home_team_id: input.homeTeamId,
      league_season_id: input.seasonId,
      matchup_id: input.matchupId,
      published_at: new Date(),
      starts_at: new Date(Date.UTC(2026, 8, 1, 8, input.sequence)),
      status: 'live',
      venue_id: input.venueId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable('competition.matchups')
    .set({ status: 'scheduled' })
    .where('id', '=', input.matchupId)
    .execute();
  await db
    .insertInto('access.game_scorekeeper_assignments')
    .values({
      game_id: game.id,
      organization_member_id: input.scorekeeperMemberId,
    })
    .execute();
  await db
    .insertInto('access.game_statistician_assignments')
    .values({
      game_id: game.id,
      organization_member_id: input.statisticianMemberId,
    })
    .execute();
  await db
    .insertInto('statistics.game_stat_sheets')
    .values({
      away_player_points: input.awayScore,
      home_player_points: input.homeScore,
      reconciled_at: new Date(),
      game_id: game.id,
      status: 'submitted',
      submitted_at: new Date(),
      version: 1,
    })
    .execute();

  for (const [teamId, points] of [
    [input.homeTeamId, input.homeScore],
    [input.awayTeamId, input.awayScore],
  ] as const) {
    const roster = input.rosterByTeamId.get(teamId)!;
    const snapshot = await db
      .insertInto('scoring.game_roster_snapshots')
      .values({
        game_id: game.id,
        source_roster_version_id: roster.rosterVersionId,
        team_id: teamId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const player = await db
      .insertInto('scoring.game_roster_players')
      .values({
        game_roster_snapshot_id: snapshot.id,
        jersey_number: '1',
        name: roster.playerName,
        position: 'Guard',
        sort_order: 1,
        source_player_id: roster.playerId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('statistics.player_box_scores')
      .values({
        assists: 4,
        game_id: game.id,
        game_roster_player_id: player.id,
        points,
        rebounds: 6,
        steals: 2,
        team_id: teamId,
        turnovers: 1,
      })
      .execute();
  }
  return game;
}

describe('Basketball League OS MVP database pilot', () => {
  const databaseService = new DatabaseService();

  afterAll(async () => {
    await databaseService.onModuleDestroy();
  });

  it('runs pooled crossover and direct double-elimination seasons end to end', async () => {
    const pilot = await rollbackPilot(databaseService.db, async (trx) => {
      const db = trx as any;
      const suffix = randomUUID().slice(0, 8);
      const organizationId = randomUUID();
      const seasonId = randomUUID();
      const venueId = randomUUID();
      const userIds = {
        admin: randomUUID(),
        scorekeeper: randomUUID(),
        statistician: randomUUID(),
      };
      await db
        .insertInto('auth.users')
        .values([
          {
            email: `pilot-admin-${suffix}@example.test`,
            id: userIds.admin,
            name: 'Pilot Admin',
          },
          {
            email: `pilot-scorekeeper-${suffix}@example.test`,
            id: userIds.scorekeeper,
            name: 'Pilot Scorekeeper',
          },
          {
            email: `pilot-statistician-${suffix}@example.test`,
            id: userIds.statistician,
            name: 'Pilot Statistician',
          },
        ])
        .execute();
      await db
        .insertInto('admin.organizations')
        .values({
          id: organizationId,
          name: 'MVP Pilot League',
          slug: `mvp-pilot-${suffix}`,
        })
        .execute();
      const memberIds = {
        admin: randomUUID(),
        scorekeeper: randomUUID(),
        statistician: randomUUID(),
      };
      await db
        .insertInto('admin.organization_members')
        .values([
          {
            id: memberIds.admin,
            organization_id: organizationId,
            role: 'admin',
            user_id: userIds.admin,
          },
          {
            id: memberIds.scorekeeper,
            organization_id: organizationId,
            role: 'scorekeeper',
            user_id: userIds.scorekeeper,
          },
          {
            id: memberIds.statistician,
            organization_id: organizationId,
            role: 'statistician',
            user_id: userIds.statistician,
          },
        ])
        .execute();
      await db
        .insertInto('admin.league_seasons')
        .values({
          default_crossover_template: JSON.stringify([
            { awaySeed: 'B2', homeSeed: 'A1' },
            { awaySeed: 'A2', homeSeed: 'B1' },
          ]),
          default_playoff_format: 'single_elimination',
          default_pool_count: 2,
          default_qualifiers_per_pool: 2,
          default_qualifying_format: 'single_round_robin',
          default_tiebreakers: JSON.stringify([
            'win_percentage',
            'head_to_head',
            'point_differential',
            'points_for',
            'manual_decision',
          ]),
          id: seasonId,
          name: '2026 MVP Pilot',
          organization_id: organizationId,
          public_enabled: true,
          schedule_slot_duration_minutes: 90,
          slug: `pilot-season-${suffix}`,
          status: 'active',
        })
        .execute();
      await db
        .insertInto('admin.venues')
        .values({
          id: venueId,
          league_season_id: seasonId,
          name: 'Pilot Court',
          slug: `pilot-court-${suffix}`,
        })
        .execute();

      const access: OrganizationAccessContext = {
        membershipId: memberIds.admin,
        organizationId,
        permissions: getPermissionsForOrganizationRole(AUTH_ROLES.ADMIN),
        role: AUTH_ROLES.ADMIN,
        userId: userIds.admin,
      };
      const notificationWriter = {
        create: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
      };
      const coordinator = new OfficialResultCoordinator(
        trx as any,
        notificationWriter as any,
      );

      const poolDivisionId = randomUUID();
      const poolFormatId = randomUUID();
      await db
        .insertInto('admin.divisions')
        .values({
          id: poolDivisionId,
          league_season_id: seasonId,
          name: 'Open Division',
          slug: `open-${suffix}`,
        })
        .execute();
      await db
        .insertInto('competition.division_formats')
        .values({
          crossover_template: JSON.stringify([
            { awaySeed: 'B2', homeSeed: 'A1' },
            { awaySeed: 'A2', homeSeed: 'B1' },
          ]),
          division_id: poolDivisionId,
          generated_at: new Date(),
          id: poolFormatId,
          locked_at: new Date(),
          playoff_format: 'single_elimination',
          pool_count: 2,
          qualifiers_per_pool: 2,
          qualifying_format: 'single_round_robin',
          status: 'locked',
          tiebreakers: JSON.stringify([
            'win_percentage',
            'head_to_head',
            'point_differential',
            'points_for',
            'manual_decision',
          ]),
        })
        .execute();
      const poolIds = { A: randomUUID(), B: randomUUID() };
      await db
        .insertInto('competition.pools')
        .values([
          {
            code: 'A',
            division_format_id: poolFormatId,
            id: poolIds.A,
            name: 'Pool A',
            sort_order: 1,
          },
          {
            code: 'B',
            division_format_id: poolFormatId,
            id: poolIds.B,
            name: 'Pool B',
            sort_order: 2,
          },
        ])
        .execute();
      const poolTeamIds = Array.from({ length: 8 }, () => randomUUID());
      const poolLabels = new Map(
        poolTeamIds.map((teamId, index) => [
          teamId,
          `${index < 4 ? 'A' : 'B'}${(index % 4) + 1}`,
        ]),
      );
      await db
        .insertInto('admin.teams')
        .values(
          poolTeamIds.map((id, index) => ({
            color: index < 4 ? '#2563eb' : '#dc2626',
            division_id: poolDivisionId,
            id,
            name: poolLabels.get(id),
            slug: `pool-team-${index + 1}-${suffix}`,
          })),
        )
        .execute();
      await db
        .insertInto('competition.pool_teams')
        .values(
          poolTeamIds.map((teamId, index) => ({
            pool_id: index < 4 ? poolIds.A : poolIds.B,
            seed: (index % 4) + 1,
            team_id: teamId,
          })),
        )
        .execute();
      const poolRosters = await seedPublishedRosters(
        trx,
        poolTeamIds,
        memberIds.admin,
        poolLabels,
      );
      const poolPlan = buildCompetitionPlan({
        crossoverTemplate: [
          { awaySeed: 'B2', homeSeed: 'A1' },
          { awaySeed: 'A2', homeSeed: 'B1' },
        ],
        playoffFormat: 'single_elimination',
        pools: [
          { code: 'A', id: poolIds.A, teamIds: poolTeamIds.slice(0, 4) },
          { code: 'B', id: poolIds.B, teamIds: poolTeamIds.slice(4, 8) },
        ],
        qualifiersPerPool: 2,
        qualifyingFormat: 'single_round_robin',
      });
      await insertPlan(trx, poolFormatId, poolPlan);

      let gameSequence = 0;
      const qualifierMatchups = await db
        .selectFrom('competition.matchups')
        .selectAll()
        .where('division_format_id', '=', poolFormatId)
        .where('stage', '=', 'qualifier')
        .orderBy('round_number asc')
        .orderBy('position asc')
        .execute();
      for (const matchup of qualifierMatchups) {
        const homeRank = Number(poolLabels.get(matchup.home_team_id)?.slice(1));
        const awayRank = Number(poolLabels.get(matchup.away_team_id)?.slice(1));
        const homeWins = homeRank < awayRank;
        const game = await prepareScoredGame(trx, {
          awayScore: homeWins ? 70 : 80,
          awayTeamId: matchup.away_team_id,
          divisionId: poolDivisionId,
          homeScore: homeWins ? 80 : 70,
          homeTeamId: matchup.home_team_id,
          matchupId: matchup.id,
          rosterByTeamId: poolRosters,
          scorekeeperMemberId: memberIds.scorekeeper,
          seasonId,
          sequence: gameSequence++,
          statisticianMemberId: memberIds.statistician,
          venueId,
        });
        await coordinator.finalizeInTransaction(trx, {
          access,
          awayScore: homeWins ? 70 : 80,
          gameId: game.id,
          homeScore: homeWins ? 80 : 70,
          organizationId,
          source: 'scorekeeper',
        });
      }
      const standings = await db
        .selectFrom('competition.standings_projections')
        .selectAll()
        .where('division_format_id', '=', poolFormatId)
        .execute();
      expect(standings).toHaveLength(8);
      expect(
        standings.filter(
          (row: { qualification_status: string }) =>
            row.qualification_status === 'qualified',
        ),
      ).toHaveLength(4);

      let finalGameId = '';
      while (true) {
        const format = await db
          .selectFrom('competition.division_formats')
          .select('status')
          .where('id', '=', poolFormatId)
          .executeTakeFirstOrThrow();
        if (format.status === 'completed') break;
        const ready = await db
          .selectFrom('competition.matchups')
          .selectAll()
          .where('division_format_id', '=', poolFormatId)
          .where('stage', '=', 'playoff')
          .where('status', '=', 'ready')
          .orderBy('round_number asc')
          .orderBy('position asc')
          .execute();
        expect(ready.length).toBeGreaterThan(0);
        for (const matchup of ready) {
          const game = await prepareScoredGame(trx, {
            awayScore: 78,
            awayTeamId: matchup.away_team_id,
            divisionId: poolDivisionId,
            homeScore: 82,
            homeTeamId: matchup.home_team_id,
            matchupId: matchup.id,
            rosterByTeamId: poolRosters,
            scorekeeperMemberId: memberIds.scorekeeper,
            seasonId,
            sequence: gameSequence++,
            statisticianMemberId: memberIds.statistician,
            venueId,
          });
          finalGameId = game.id;
          const callsBefore = notificationWriter.create.mock.calls.length;
          await coordinator.finalizeInTransaction(trx, {
            access,
            awayScore: 78,
            gameId: game.id,
            homeScore: 82,
            organizationId,
            source: 'scorekeeper',
          });
          if (matchup.bracket_side === 'finals') {
            await coordinator.finalizeInTransaction(trx, {
              access,
              awayScore: 78,
              gameId: game.id,
              homeScore: 82,
              organizationId,
              source: 'scorekeeper',
            });
            expect(notificationWriter.create.mock.calls.length).toBeGreaterThan(
              callsBefore,
            );
          }
        }
      }
      const poolChampion = await db
        .selectFrom('competition.matchups')
        .select('winner_team_id')
        .where('division_format_id', '=', poolFormatId)
        .where('stage', '=', 'playoff')
        .where('winner_to_matchup_id', 'is', null)
        .where('status', '=', 'final')
        .executeTakeFirstOrThrow();
      const statisticsService = new StatisticsService(
        reusePilotTransaction(trx),
        coordinator,
      );
      const awardState = await statisticsService.getPlayerOfGame(
        organizationId,
        finalGameId,
        access,
      );
      await statisticsService.confirmPlayerOfGame(
        organizationId,
        finalGameId,
        access,
        awardState.suggestion.playerId,
      );

      const doubleDivisionId = randomUUID();
      const doubleFormatId = randomUUID();
      await db
        .insertInto('admin.divisions')
        .values({
          id: doubleDivisionId,
          league_season_id: seasonId,
          name: 'Double Elimination Division',
          slug: `double-${suffix}`,
        })
        .execute();
      await db
        .insertInto('competition.division_formats')
        .values({
          crossover_template: JSON.stringify([]),
          division_id: doubleDivisionId,
          generated_at: new Date(),
          id: doubleFormatId,
          locked_at: new Date(),
          playoff_format: 'double_elimination',
          pool_count: 1,
          qualifiers_per_pool: 8,
          qualifying_format: 'none',
          status: 'locked',
          tiebreakers: JSON.stringify(['win_percentage', 'manual_decision']),
        })
        .execute();
      const doubleTeamIds = Array.from({ length: 8 }, () => randomUUID());
      const doubleLabels = new Map(
        doubleTeamIds.map((teamId, index) => [teamId, `D${index + 1}`]),
      );
      await db
        .insertInto('admin.teams')
        .values(
          doubleTeamIds.map((id, index) => ({
            division_id: doubleDivisionId,
            id,
            name: doubleLabels.get(id),
            slug: `double-team-${index + 1}-${suffix}`,
          })),
        )
        .execute();
      const doubleRosters = await seedPublishedRosters(
        trx,
        doubleTeamIds,
        memberIds.admin,
        doubleLabels,
      );
      await insertPlan(
        trx,
        doubleFormatId,
        buildCompetitionPlan({
          crossoverTemplate: [],
          directSeedTeamIds: doubleTeamIds,
          playoffFormat: 'double_elimination',
          pools: [],
          qualifiersPerPool: 8,
          qualifyingFormat: 'none',
        }),
      );

      let doubleGameCount = 0;
      while (true) {
        const format = await db
          .selectFrom('competition.division_formats')
          .select('status')
          .where('id', '=', doubleFormatId)
          .executeTakeFirstOrThrow();
        if (format.status === 'completed') break;
        const ready = await db
          .selectFrom('competition.matchups')
          .selectAll()
          .where('division_format_id', '=', doubleFormatId)
          .where('status', '=', 'ready')
          .orderBy('bracket_side asc')
          .orderBy('round_number asc')
          .orderBy('position asc')
          .execute();
        expect(ready.length).toBeGreaterThan(0);
        for (const matchup of ready) {
          const losersChampionWinsGrandFinal =
            matchup.bracket_side === 'finals' && !matchup.is_reset_final;
          const homeScore = losersChampionWinsGrandFinal ? 78 : 82;
          const awayScore = losersChampionWinsGrandFinal ? 82 : 78;
          const game = await prepareScoredGame(trx, {
            awayScore,
            awayTeamId: matchup.away_team_id,
            divisionId: doubleDivisionId,
            homeScore,
            homeTeamId: matchup.home_team_id,
            matchupId: matchup.id,
            rosterByTeamId: doubleRosters,
            scorekeeperMemberId: memberIds.scorekeeper,
            seasonId,
            sequence: gameSequence++,
            statisticianMemberId: memberIds.statistician,
            venueId,
          });
          await coordinator.finalizeInTransaction(trx, {
            access,
            awayScore,
            gameId: game.id,
            homeScore,
            organizationId,
            source: 'scorekeeper',
          });
          doubleGameCount += 1;
        }
      }
      expect(doubleGameCount).toBe(15);
      const doubleFinals = await db
        .selectFrom('competition.matchups')
        .selectAll()
        .where('division_format_id', '=', doubleFormatId)
        .where('status', '=', 'final')
        .execute();
      const resetFinal = doubleFinals.find(
        (matchup: { is_reset_final: boolean }) => matchup.is_reset_final,
      );
      expect(resetFinal?.winner_team_id).toBeTruthy();
      const losses = new Map<string, number>();
      for (const matchup of doubleFinals) {
        if (matchup.loser_team_id) {
          losses.set(
            matchup.loser_team_id,
            (losses.get(matchup.loser_team_id) ?? 0) + 1,
          );
        }
      }
      expect(losses.get(resetFinal.winner_team_id)).toBe(1);
      expect(
        doubleTeamIds
          .filter((teamId) => teamId !== resetFinal.winner_team_id)
          .every((teamId) => losses.get(teamId) === 2),
      ).toBe(true);

      const publicPortal = await new PublicService(trx as any).getLeaguePortal(
        `mvp-pilot-${suffix}`,
        `pilot-season-${suffix}`,
      );
      expect(publicPortal.standings).toHaveLength(8);
      expect(publicPortal.awards).toHaveLength(1);
      expect(publicPortal.leaders.length).toBeGreaterThan(0);
      expect(
        publicPortal.bracket.some(
          (matchup: { winner_team_id: string | null }) =>
            matchup.winner_team_id === poolChampion.winner_team_id,
        ),
      ).toBe(true);

      return {
        doubleChampionId: resetFinal.winner_team_id,
        doubleGameCount,
        notificationWrites: notificationWriter.create.mock.calls.length,
        poolChampionId: poolChampion.winner_team_id,
        publicAwardCount: publicPortal.awards.length,
      };
    });

    expect(pilot).toEqual(
      expect.objectContaining({
        doubleChampionId: expect.any(String),
        doubleGameCount: 15,
        notificationWrites: expect.any(Number),
        poolChampionId: expect.any(String),
        publicAwardCount: 1,
      }),
    );
    expect(pilot.notificationWrites).toBeGreaterThan(20);
  });

  it('recalculates a 32-team double round robin within one second on the development database', async () => {
    const elapsedMs = await rollbackPilot(databaseService.db, async (trx) => {
      const db = trx as any;
      const suffix = randomUUID().slice(0, 8);
      const organizationId = randomUUID();
      const userId = randomUUID();
      const memberId = randomUUID();
      const seasonId = randomUUID();
      const divisionId = randomUUID();
      const formatId = randomUUID();
      const poolId = randomUUID();
      const venueId = randomUUID();
      await db
        .insertInto('auth.users')
        .values({
          email: `performance-${suffix}@example.test`,
          id: userId,
          name: 'Performance Admin',
        })
        .execute();
      await db
        .insertInto('admin.organizations')
        .values({
          id: organizationId,
          name: 'Performance League',
          slug: `performance-${suffix}`,
        })
        .execute();
      await db
        .insertInto('admin.organization_members')
        .values({
          id: memberId,
          organization_id: organizationId,
          role: 'admin',
          user_id: userId,
        })
        .execute();
      await db
        .insertInto('admin.league_seasons')
        .values({
          id: seasonId,
          name: 'Performance Season',
          organization_id: organizationId,
          slug: `performance-${suffix}`,
        })
        .execute();
      await db
        .insertInto('admin.divisions')
        .values({
          id: divisionId,
          league_season_id: seasonId,
          name: '32 Team Division',
          slug: `performance-${suffix}`,
        })
        .execute();
      await db
        .insertInto('admin.venues')
        .values({
          id: venueId,
          league_season_id: seasonId,
          name: 'Performance Court',
          slug: `performance-${suffix}`,
        })
        .execute();
      const tiebreakers = [
        'win_percentage',
        'head_to_head',
        'point_differential',
        'points_for',
        'manual_decision',
      ];
      await db
        .insertInto('competition.division_formats')
        .values({
          division_id: divisionId,
          generated_at: new Date(),
          id: formatId,
          locked_at: new Date(),
          playoff_format: 'none',
          pool_count: 1,
          qualifiers_per_pool: 4,
          qualifying_format: 'double_round_robin',
          status: 'locked',
          tiebreakers: JSON.stringify(tiebreakers),
        })
        .execute();
      await db
        .insertInto('competition.pools')
        .values({
          code: 'A',
          division_format_id: formatId,
          id: poolId,
          name: 'Pool A',
          sort_order: 1,
        })
        .execute();
      const teamIds = Array.from({ length: 32 }, () => randomUUID());
      await db
        .insertInto('admin.teams')
        .values(
          teamIds.map((id, index) => ({
            division_id: divisionId,
            id,
            name: `Team ${index + 1}`,
            slug: `performance-team-${index + 1}-${suffix}`,
          })),
        )
        .execute();
      await db
        .insertInto('competition.pool_teams')
        .values(
          teamIds.map((team_id, index) => ({
            pool_id: poolId,
            seed: index + 1,
            team_id,
          })),
        )
        .execute();
      const plan = buildCompetitionPlan({
        crossoverTemplate: [],
        playoffFormat: 'none',
        pools: [{ code: 'A', id: poolId, teamIds }],
        qualifiersPerPool: 4,
        qualifyingFormat: 'double_round_robin',
      });
      await insertPlan(trx, formatId, plan);
      const matchups = await db
        .selectFrom('competition.matchups')
        .selectAll()
        .where('division_format_id', '=', formatId)
        .execute();
      const teamOrder = new Map(
        teamIds.map((teamId, index) => [teamId, index]),
      );
      const games = matchups.map((matchup: any, index: number) => {
        const homeWins =
          (teamOrder.get(matchup.home_team_id) ?? Number.MAX_SAFE_INTEGER) <
          (teamOrder.get(matchup.away_team_id) ?? Number.MAX_SAFE_INTEGER);
        return {
          away_score: homeWins ? 70 : 80,
          away_team_id: matchup.away_team_id,
          competition_kind: 'stage',
          division_id: divisionId,
          finalized_at: new Date(),
          home_score: homeWins ? 80 : 70,
          home_team_id: matchup.home_team_id,
          id: randomUUID(),
          league_season_id: seasonId,
          matchup_id: matchup.id,
          published_at: new Date(),
          starts_at: new Date(Date.UTC(2026, 9, 1) + index * 5_400_000),
          status: 'final',
          venue_id: venueId,
        };
      });
      await db.insertInto('competition.games').values(games).execute();
      await db
        .updateTable('competition.matchups')
        .set({ status: 'final' })
        .where('division_format_id', '=', formatId)
        .execute();
      const access: OrganizationAccessContext = {
        membershipId: memberId,
        organizationId,
        permissions: getPermissionsForOrganizationRole(AUTH_ROLES.ADMIN),
        role: AUTH_ROLES.ADMIN,
        userId,
      };
      const coordinator = new OfficialResultCoordinator(
        trx as any,
        {
          create: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        } as any,
      );
      const startedAt = performance.now();
      await (coordinator as any).rebuildPoolStandings(
        trx,
        {
          id: formatId,
          qualifiers_per_pool: 4,
          tiebreakers,
        },
        games.at(-1),
        {
          access,
          awayScore: games.at(-1).away_score,
          gameId: games.at(-1).id,
          homeScore: games.at(-1).home_score,
          organizationId,
          source: 'manual',
        },
      );
      const elapsed = performance.now() - startedAt;
      const standingsCount = await db
        .selectFrom('competition.standings_projections')
        .select(({ fn }: any) => fn.countAll().as('count'))
        .where('division_format_id', '=', formatId)
        .executeTakeFirstOrThrow();
      expect(Number(standingsCount.count)).toBe(32);
      return elapsed;
    });

    expect(elapsedMs).toBeLessThan(1_000);
  });
});
