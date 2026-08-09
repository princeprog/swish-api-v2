import { createAppConfig, getCorsOrigins } from './app.config';

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
        port: 3001,
        serviceName: 'swish-api-v2',
      },
      auth: {
        accessCookieName: 'swish_access_token',
        accessTokenExpiresIn: '15m',
        accessTokenSecret: 'access-secret',
        corsOrigin: 'http://192.168.0.100:8081',
        refreshCookieName: 'swish_refresh_token',
        refreshTokenExpiresIn: '30d',
        refreshTokenSecret: 'refresh-secret',
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

  it('includes the local frontend in the allowed CORS origins', () => {
    expect(getCorsOrigins(createAppConfig(validEnv).auth.corsOrigin)).toEqual([
      'http://192.168.0.100:8081',
      'http://localhost:3000',
    ]);
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

  it('rejects an invalid JWT_ACCESS_EXPIRES_IN value', () => {
    expect(() =>
      createAppConfig({
        ...validEnv,
        JWT_ACCESS_EXPIRES_IN: 'tomorrow',
      }),
    ).toThrow('JWT_ACCESS_EXPIRES_IN must use a duration like 15m or 1h');
  });
});
