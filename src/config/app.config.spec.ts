import { createAppConfig } from './app.config';

const validEnv = {
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USER: 'postgres',
  DB_PASSWORD: 'password',
  DB_NAME: 'swish-db-v2',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
};

describe('createAppConfig', () => {
  it('builds app, database, and auth config from environment variables', () => {
    expect(createAppConfig(validEnv)).toEqual({
      app: {
        environment: 'development',
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
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'password',
        database: 'swish-db-v2',
      },
    });
  });

  it('requires JWT_ACCESS_SECRET', () => {
    expect(() =>
      createAppConfig({
        ...validEnv,
        JWT_ACCESS_SECRET: '',
      }),
    ).toThrow('Missing required app env var: JWT_ACCESS_SECRET');
  });

  it('requires JWT_REFRESH_SECRET', () => {
    expect(() =>
      createAppConfig({
        ...validEnv,
        JWT_REFRESH_SECRET: '',
      }),
    ).toThrow('Missing required app env var: JWT_REFRESH_SECRET');
  });

  it('rejects an invalid PORT value', () => {
    expect(() =>
      createAppConfig({
        ...validEnv,
        PORT: 'invalid',
      }),
    ).toThrow('PORT must be a positive integer');
  });
});
