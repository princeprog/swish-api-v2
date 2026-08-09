import type { JwtSignOptions } from '@nestjs/jwt';
import { createDatabasePoolConfig } from '../database/database.config';

export const APP_CONFIG = 'APP_CONFIG';

type AppEnvironment = 'development' | 'production' | 'test';
type JwtDuration = NonNullable<JwtSignOptions['expiresIn']>;

export type AppConfig = {
  app: {
    environment: AppEnvironment;
    port: number;
    serviceName: string;
  };
  auth: {
    accessCookieName: string;
    accessTokenExpiresIn: JwtDuration;
    accessTokenSecret: string;
    corsOrigin: string;
    refreshCookieName: string;
    refreshTokenExpiresIn: string;
    refreshTokenSecret: string;
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
    return 3001;
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

function parseJwtDuration(value: string | undefined): JwtDuration {
  const duration = value ?? '15m';

  if (!/^\d+[smhd]$/.test(duration)) {
    throw new Error('JWT_ACCESS_EXPIRES_IN must use a duration like 15m or 1h');
  }

  return duration as JwtDuration;
}

export function getCorsOrigins(configuredOrigin: string): string[] {
  return Array.from(new Set([configuredOrigin, 'http://localhost:3000']));
}

export function createAppConfig(env: NodeJS.ProcessEnv): AppConfig {
  const environment = parseEnvironment(env.NODE_ENV);
  const accessTokenSecret = requireAppEnv(env, 'JWT_ACCESS_SECRET');
  const refreshTokenSecret = requireAppEnv(env, 'JWT_REFRESH_SECRET');
  const corsOrigin = env.CORS_ORIGIN ?? 'http://192.168.0.100:8081';

  return {
    app: {
      environment,
      port: parsePort(env.PORT),
      serviceName: env.SERVICE_NAME ?? 'swish-api-v2',
    },
    auth: {
      accessCookieName: env.AUTH_ACCESS_COOKIE_NAME ?? 'swish_access_token',
      accessTokenExpiresIn: parseJwtDuration(env.JWT_ACCESS_EXPIRES_IN),
      accessTokenSecret,
      corsOrigin,
      refreshCookieName: env.AUTH_REFRESH_COOKIE_NAME ?? 'swish_refresh_token',
      refreshTokenExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '30d',
      refreshTokenSecret,
      secureCookies: parseBoolean(
        env.AUTH_COOKIE_SECURE,
        environment === 'production',
      ),
    },
    database: createDatabasePoolConfig(env),
  };
}
