import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Transaction } from 'kysely';
import request from 'supertest';
import type { App } from 'supertest/types';
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

async function createPilotApp(trx: Trx): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DATABASE)
    .useValue(transactionProxy(trx))
    .compile();

  const app = moduleFixture.createNestApplication<App>();
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
              .post(
                `/organizations/${organization.body.id}/league-seasons`,
              )
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
});
