import type { Database } from '../database/database.tokens';
import type { AppConfig } from '../config/app.config';
import { HealthService } from './health.service';

const config: AppConfig = {
  app: {
    environment: 'test',
    port: 3000,
    serviceName: 'swish-api-v2',
  },
  auth: {
    accessTokenExpiresIn: '15m',
    refreshCookieName: 'swish_refresh_token',
    refreshTokenExpiresIn: '30d',
    secureCookies: false,
  },
  database: {
    database: 'swish-db-v2',
    host: 'localhost',
    password: 'password',
    port: 5432,
    user: 'postgres',
  },
};

function createDatabaseMock(result: Promise<unknown>): Database {
  return {
    selectNoFrom: jest.fn().mockReturnValue({
      executeTakeFirst: jest.fn().mockReturnValue(result),
    }),
  } as unknown as Database;
}

describe('HealthService', () => {
  it('returns a health summary without querying the database', () => {
    const db = createDatabaseMock(Promise.resolve({ ok: 1 }));
    const service = new HealthService(config, db);

    expect(service.getHealth()).toMatchObject({
      checks: {
        config: 'ok',
        database: 'configured',
      },
      environment: 'test',
      service: 'swish-api-v2',
      status: 'ok',
    });
    expect(db.selectNoFrom).not.toHaveBeenCalled();
  });

  it('returns ready when the database ping succeeds', async () => {
    const service = new HealthService(
      config,
      createDatabaseMock(Promise.resolve({ ok: 1 })),
    );

    await expect(service.getReadiness()).resolves.toMatchObject({
      checks: {
        config: 'ok',
        database: 'ok',
      },
      status: 'ok',
    });
  });

  it('returns not ready when the database ping fails', async () => {
    const service = new HealthService(
      config,
      createDatabaseMock(Promise.reject(new Error('database unavailable'))),
    );

    await expect(service.getReadiness()).resolves.toMatchObject({
      checks: {
        config: 'ok',
        database: 'error',
      },
      status: 'error',
    });
  });
});
