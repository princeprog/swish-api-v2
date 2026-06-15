import type { PoolConfig } from 'pg';

function requireEnv(
  env: NodeJS.ProcessEnv,
  key: 'DB_HOST' | 'DB_PORT' | 'DB_USER' | 'DB_PASSWORD' | 'DB_NAME',
): string {
  const value = env[key];

  if (!value) {
    throw new Error(`Missing required database env var: ${key}`);
  }

  return value;
}

export function createDatabasePoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const port = Number(requireEnv(env, 'DB_PORT'));

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('DB_PORT must be a positive integer');
  }

  return {
    host: requireEnv(env, 'DB_HOST'),
    port,
    user: requireEnv(env, 'DB_USER'),
    password: requireEnv(env, 'DB_PASSWORD'),
    database: requireEnv(env, 'DB_NAME'),
  };
}
