import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Transaction } from 'kysely';
import request from 'supertest';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { DATABASE } from '../src/database/database.tokens';
import { DatabaseService } from '../src/database/database.module';
import type { DB } from '../src/database/db';
import { AppModule } from '../src/app.module';

jest.setTimeout(60_000);

type Trx = Transaction<DB>;

class RollbackPilot<T> extends Error {
  constructor(readonly result: T) {
    super('Rollback completed authenticated HTTP pilot.');
  }
}

function transactionProxy(trx: Trx) {
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

async function rollbackHttpPilot<T>(
  database: DatabaseService['db'],
  run: (trx: Trx) => Promise<T>,
): Promise<T> {
  try {
    await database.transaction().execute(async (trx) => {
      throw new RollbackPilot(await run(trx));
    });
  } catch (error) {
    if (error instanceof RollbackPilot) return error.result;
    throw error;
  }
  throw new Error('Authenticated HTTP pilot did not roll back as expected.');
}

async function createPilotApp(trx: Trx): Promise<INestApplication> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DATABASE)
    .useValue(transactionProxy(trx))
    .compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  await app.init();
  return app;
}

describe('authenticated MVP HTTP pilot', () => {
  it('registers, creates a season, and reads the public league shell', async () => {
    const databaseService = new DatabaseService();
    const suffix = randomUUID().slice(0, 8);
    const email = `http-pilot-${suffix}@example.test`;
    const organizationSlug = `http-pilot-${suffix}`;
    const seasonSlug = `season-${suffix}`;

    try {
      const result = await rollbackHttpPilot(
        databaseService.db,
        async (trx) => {
          const app = await createPilotApp(trx);
          try {
            const agent = request.agent(app.getHttpServer());
            const registration = await agent
              .post('/auth/register')
              .send({
                email,
                name: 'HTTP Pilot Owner',
                password: 'SecurePilotPassword123!',
              })
              .expect(201);

            const organization = await agent
              .post('/organizations')
              .send({ name: 'HTTP Pilot League', slug: organizationSlug })
              .expect(201);

            await agent
              .post(`/organizations/${organization.body.id}/league-seasons`)
              .send({
                competitionDefaults: {
                  crossoverTemplate: [],
                  playoffFormat: 'single_elimination',
                  poolCount: 1,
                  qualifiersPerPool: 2,
                  qualifyingFormat: 'single_round_robin',
                  tiebreakers: [
                    'win_percentage',
                    'head_to_head',
                    'point_differential',
                    'points_for',
                    'manual_decision',
                  ],
                },
                gameRules: {
                  overtimeDurationMs: 300_000,
                  periodDurationMs: 600_000,
                  personalFoulLimit: 5,
                  regulationPeriods: 4,
                  shotClockEnabled: false,
                  shotClockFullMs: 24_000,
                  shotClockShortMs: 14_000,
                  teamFoulsBeforePenalty: 5,
                  timeoutsFirstHalf: 3,
                  timeoutsPerOvertime: 1,
                  timeoutsSecondHalf: 3,
                },
                name: 'HTTP Pilot Season',
                organizationId: organization.body.id,
                publicEnabled: true,
                slug: seasonSlug,
              })
              .expect(201);

            const me = await agent.get('/auth/me').expect(200);
            const organizations = await agent.get('/organizations').expect(200);
            const publicOrganization = await request(app.getHttpServer())
              .get(`/public/organizations/${organizationSlug}`)
              .expect(200);

            return {
              email: registration.body.user.email,
              meEmail: me.body.user.email,
              organizationCount: organizations.body.length,
              publicSeasonSlug: publicOrganization.body.seasons[0].slug,
            };
          } finally {
            await app.close();
          }
        },
      );

      expect(result).toEqual({
        email,
        meEmail: email,
        organizationCount: 1,
        publicSeasonSlug: seasonSlug,
      });
    } finally {
      await databaseService.onModuleDestroy();
    }
  });

  it('drives an assigned game through authenticated scoring, statistics, and finalization', async () => {
    const databaseService = new DatabaseService();
    const suffix = randomUUID().slice(0, 8);
    const organizationSlug = `http-game-${suffix}`;
    const seasonSlug = `season-${suffix}`;
    const password = 'SecurePilotPassword123!';
    const occurredAt = () => new Date().toISOString();

    try {
      const result = await rollbackHttpPilot(
        databaseService.db,
        async (trx) => {
          const app = await createPilotApp(trx);
          try {
            const owner = request.agent(app.getHttpServer());
            const scorekeeper = request.agent(app.getHttpServer());
            const statistician = request.agent(app.getHttpServer());
            const ownerRegistration = await owner
              .post('/auth/register')
              .send({
                email: `http-game-owner-${suffix}@example.test`,
                name: 'HTTP Game Owner',
                password,
              })
              .expect(201);
            const scorekeeperRegistration = await scorekeeper
              .post('/auth/register')
              .send({
                email: `http-game-scorekeeper-${suffix}@example.test`,
                name: 'HTTP Game Scorekeeper',
                password,
              })
              .expect(201);
            const statisticianRegistration = await statistician
              .post('/auth/register')
              .send({
                email: `http-game-statistician-${suffix}@example.test`,
                name: 'HTTP Game Statistician',
                password,
              })
              .expect(201);

            const organization = await owner
              .post('/organizations')
              .send({ name: 'HTTP Game League', slug: organizationSlug })
              .expect(201);
            const organizationId = organization.body.id as string;
            const season = await owner
              .post(`/organizations/${organizationId}/league-seasons`)
              .send({
                competitionDefaults: {
                  crossoverTemplate: [],
                  playoffFormat: 'none',
                  poolCount: 1,
                  qualifiersPerPool: 1,
                  qualifyingFormat: 'none',
                  tiebreakers: ['win_percentage', 'manual_decision'],
                },
                gameRules: {
                  overtimeDurationMs: 60_000,
                  periodDurationMs: 60_000,
                  personalFoulLimit: 5,
                  regulationPeriods: 4,
                  shotClockEnabled: false,
                  shotClockFullMs: 24_000,
                  shotClockShortMs: 14_000,
                  teamFoulsBeforePenalty: 4,
                  timeoutsFirstHalf: 2,
                  timeoutsPerOvertime: 1,
                  timeoutsSecondHalf: 3,
                },
                name: 'HTTP Game Season',
                organizationId,
                publicEnabled: true,
                slug: seasonSlug,
                status: 'active',
              })
              .expect(201);
            const seasonId = season.body.id as string;
            const division = await owner
              .post(`/organizations/${organizationId}/divisions`)
              .send({
                leagueSeasonId: seasonId,
                name: 'HTTP Game Division',
                slug: `division-${suffix}`,
              })
              .expect(201);
            const divisionId = division.body.id as string;
            const homeTeam = await owner
              .post(`/organizations/${organizationId}/teams`)
              .send({
                color: '#2563eb',
                divisionId,
                name: 'HTTP Home Bears',
                slug: `home-bears-${suffix}`,
              })
              .expect(201);
            const awayTeam = await owner
              .post(`/organizations/${organizationId}/teams`)
              .send({
                color: '#dc2626',
                divisionId,
                name: 'HTTP Away Lions',
                slug: `away-lions-${suffix}`,
              })
              .expect(201);
            const homeTeamId = homeTeam.body.id as string;
            const awayTeamId = awayTeam.body.id as string;
            const homePlayer = await owner
              .post(`/organizations/${organizationId}/players`)
              .send({
                jerseyNumber: '7',
                name: 'HTTP Home Captain',
                position: 'guard',
                teamId: homeTeamId,
              })
              .expect(201);
            const awayPlayer = await owner
              .post(`/organizations/${organizationId}/players`)
              .send({
                jerseyNumber: '8',
                name: 'HTTP Away Captain',
                position: 'guard',
                teamId: awayTeamId,
              })
              .expect(201);
            const venue = await owner
              .post(`/organizations/${organizationId}/venues`)
              .send({
                leagueSeasonId: seasonId,
                name: 'HTTP Game Court',
                slug: `http-game-court-${suffix}`,
              })
              .expect(201);

            const memberRows = await trx
              .selectFrom('admin.organization_members')
              .select(['id', 'user_id'])
              .where('organization_id', '=', organizationId)
              .execute();
            const ownerMember = memberRows.find(
              (member) => member.user_id === ownerRegistration.body.user.id,
            );
            if (!ownerMember)
              throw new Error('HTTP owner membership was not created.');
            await trx
              .insertInto('admin.organization_members')
              .values([
                {
                  organization_id: organizationId,
                  role: 'scorekeeper',
                  status: 'active',
                  user_id: scorekeeperRegistration.body.user.id,
                },
                {
                  organization_id: organizationId,
                  role: 'statistician',
                  status: 'active',
                  user_id: statisticianRegistration.body.user.id,
                },
              ])
              .returning(['id', 'role', 'user_id'])
              .execute();
            const staffRows = await trx
              .selectFrom('admin.organization_members')
              .select(['id', 'role', 'user_id'])
              .where('organization_id', '=', organizationId)
              .execute();
            const scorekeeperMember = staffRows.find(
              (member) =>
                member.user_id === scorekeeperRegistration.body.user.id,
            );
            const statisticianMember = staffRows.find(
              (member) =>
                member.user_id === statisticianRegistration.body.user.id,
            );
            if (!scorekeeperMember || !statisticianMember) {
              throw new Error('HTTP game staff memberships were not created.');
            }

            const format = await trx
              .selectFrom('competition.division_formats')
              .selectAll()
              .where('division_id', '=', divisionId)
              .executeTakeFirstOrThrow();
            const pool = await trx
              .selectFrom('competition.pools')
              .selectAll()
              .where('division_format_id', '=', format.id)
              .executeTakeFirstOrThrow();
            await trx
              .updateTable('competition.division_formats')
              .set({ locked_at: new Date(), status: 'locked' })
              .where('id', '=', format.id)
              .execute();
            await trx
              .insertInto('competition.pool_teams')
              .values([
                { pool_id: pool.id, seed: 1, team_id: homeTeamId },
                { pool_id: pool.id, seed: 2, team_id: awayTeamId },
              ])
              .execute();

            for (const [teamId, player] of [
              [homeTeamId, homePlayer.body] as const,
              [awayTeamId, awayPlayer.body] as const,
            ]) {
              const roster = await trx
                .selectFrom('admin.team_rosters')
                .select('id')
                .where('team_id', '=', teamId)
                .executeTakeFirstOrThrow();
              const version = await trx
                .insertInto('admin.roster_versions')
                .values({
                  approved_by_member_id: ownerMember.id,
                  team_roster_id: roster.id,
                  version_number: 1,
                })
                .returning('id')
                .executeTakeFirstOrThrow();
              await trx
                .insertInto('admin.roster_version_players')
                .values({
                  jersey_number: player.jersey_number,
                  name: player.name,
                  position: 'Guard',
                  roster_version_id: version.id,
                  sort_order: 1,
                  source_player_id: player.id,
                })
                .execute();
              await trx
                .updateTable('admin.team_rosters')
                .set({
                  latest_approved_version_id: version.id,
                  published_at: new Date(),
                  published_version_id: version.id,
                  workflow_status: 'published',
                })
                .where('id', '=', roster.id)
                .execute();
            }

            const game = await trx
              .insertInto('competition.games')
              .values({
                away_team_id: awayTeamId,
                competition_kind: 'stage',
                division_id: divisionId,
                home_team_id: homeTeamId,
                id: randomUUID(),
                league_season_id: seasonId,
                published_at: new Date(),
                starts_at: new Date(),
                status: 'scheduled',
                venue_id: venue.body.id,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            await trx
              .insertInto('access.game_scorekeeper_assignments')
              .values({
                game_id: game.id,
                organization_member_id: scorekeeperMember.id,
              })
              .execute();
            await trx
              .insertInto('access.game_statistician_assignments')
              .values({
                game_id: game.id,
                organization_member_id: statisticianMember.id,
              })
              .execute();

            const scoringPath = `/organizations/${organizationId}/games/${game.id}/scoring`;
            const statisticsPath = `/organizations/${organizationId}/games/${game.id}/statistics`;
            const initial = await scorekeeper.get(scoringPath).expect(200);
            expect(initial.body.phase).toBe('pregame');
            const control = await scorekeeper
              .post(`${scoringPath}/control/claim`)
              .send({ deviceLabel: 'HTTP scorekeeper' })
              .expect(201);
            const controlToken = control.body.controlToken as string;
            let scoringVersion = initial.body.version as number;
            const command = async (type: string, payload?: unknown) => {
              const response = await scorekeeper
                .post(`${scoringPath}/commands`)
                .send({
                  controlToken,
                  expectedVersion: scoringVersion,
                  idempotencyKey: `http-${suffix}-${scoringVersion}-${type}`,
                  occurredAt: occurredAt(),
                  payload,
                  type,
                })
                .expect(201);
              scoringVersion = response.body.state.version;
              return response.body.state;
            };
            await command('game.start');
            await command('score.record', { points: 3, teamId: homeTeamId });
            await command('score.record', { points: 2, teamId: homeTeamId });
            await command('score.record', { points: 3, teamId: awayTeamId });
            for (let period = 1; period <= 4; period += 1) {
              await command('game_clock.adjust', {
                reason: `End quarter ${period} for the HTTP pilot`,
                remainingMs: 0,
              });
              await command('clocks.pause');
              await command('period.end');
              if (period < 4) await command('period.start');
            }

            const statisticsControl = await statistician
              .post(`${statisticsPath}/control/claim`)
              .send({ deviceLabel: 'HTTP statistician' })
              .expect(201);
            const statisticsControlToken = statisticsControl.body
              .controlToken as string;
            const statisticsState = await statistician
              .get(statisticsPath)
              .expect(200);
            const homeRosterPlayer = statisticsState.body.roster.find(
              (player: { team_id: string }) => player.team_id === homeTeamId,
            );
            const awayRosterPlayer = statisticsState.body.roster.find(
              (player: { team_id: string }) => player.team_id === awayTeamId,
            );
            if (!homeRosterPlayer || !awayRosterPlayer) {
              throw new Error('HTTP game roster snapshots were not returned.');
            }
            let statisticsVersion = statisticsState.body.version as number;
            const statistic = async (
              playerId: string,
              type: string,
              value: number,
            ) => {
              const response = await statistician
                .post(`${statisticsPath}/events`)
                .send({
                  controlToken: statisticsControlToken,
                  expectedVersion: statisticsVersion,
                  idempotencyKey: `http-stat-${suffix}-${statisticsVersion}`,
                  occurredAt: occurredAt(),
                  playerId,
                  type,
                  value,
                })
                .expect(201);
              statisticsVersion = response.body.version;
            };
            await statistic(homeRosterPlayer.id, 'points', 3);
            await statistic(homeRosterPlayer.id, 'points', 2);
            await statistic(awayRosterPlayer.id, 'points', 3);
            await statistic(homeRosterPlayer.id, 'rebound', 1);
            await statistic(homeRosterPlayer.id, 'assist', 1);
            await statistic(homeRosterPlayer.id, 'steal', 1);
            await statistic(homeRosterPlayer.id, 'turnover', 1);
            const submission = await statistician
              .post(`${statisticsPath}/submit`)
              .send({ controlToken: statisticsControlToken })
              .expect(201);
            expect(submission.body.status).toBe('submitted');
            const finalState = await command('game.finalize');
            expect(finalState.phase).toBe('final');
            const awardState = await statistician
              .get(`${statisticsPath}/player-of-game`)
              .expect(200);
            await statistician
              .post(`${statisticsPath}/player-of-game/confirm`)
              .send({ playerId: awardState.body.suggestion.playerId })
              .expect(201);
            const publicPortal = await request(app.getHttpServer())
              .get(
                `/public/organizations/${organizationSlug}/seasons/${seasonSlug}/portal`,
              )
              .expect(200);
            return {
              awayScore: finalState.scores.away,
              homeScore: finalState.scores.home,
              leaderCount: publicPortal.body.leaders.length,
              resultCount: publicPortal.body.results.length,
              standingsCount: publicPortal.body.standings.length,
              playerOfGame: awardState.body.suggestion.playerId,
            };
          } finally {
            await app.close();
          }
        },
      );

      expect(result).toEqual({
        awayScore: 3,
        homeScore: 5,
        leaderCount: 2,
        playerOfGame: expect.any(String),
        resultCount: 1,
        standingsCount: 2,
      });
    } finally {
      await databaseService.onModuleDestroy();
    }
  });
});
