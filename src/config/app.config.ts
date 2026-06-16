import { createDatabasePoolConfig } from '../database/database.config';

export const APP_CONFIG = 'APP_CONFIG';

type AppEnvironment = 'development' | 'production' | 'test';

export type AppConfig = {
  app: {
    environment: AppEnvironment;
    port: number;
    serviceName: string;
  };
  auth: {
    accessTokenExpiresIn: string;
    refreshCookieName: string;
    refreshTokenExpiresIn: string;
    secureCookies: boolean;
  };
  database: ReturnType<typeof createDatabasePoolConfig>;
};

function requireAppEnv(
  env: NodeJS.ProcessEnv,
  key: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required app env var: ${key}`);
  }

  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return port;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
}

function parseEnvironment(value: string | undefined): AppEnvironment {
  if (value === 'production' || value === 'test') {
    return value;
  }

  return 'development';
}

export function createAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const environment = parseEnvironment(env.NODE_ENV);

  requireAppEnv(env, 'JWT_ACCESS_SECRET');
  requireAppEnv(env, 'JWT_REFRESH_SECRET');

  return {
    app: {
      environment,
      port: parsePort(env.PORT),
      serviceName: env.SERVICE_NAME ?? 'swish-api-v2',
    },
    auth: {
      accessTokenExpiresIn: env.JWT_ACCESS_EXPIRES_IN ?? '15m',
      refreshCookieName: env.AUTH_REFRESH_COOKIE_NAME ?? 'swish_refresh_token',
      refreshTokenExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      secureCookies: parseBoolean(
        env.AUTH_COOKIE_SECURE,
        environment === 'production',
      ),
    },
    database: createDatabasePoolConfig(env),
  };
}
