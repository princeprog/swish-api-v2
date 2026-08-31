import 'dotenv/config';

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { Client } from 'pg';

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required database environment variable: ${key}`);
  }
}

const tempDatabase = `swish_release_${Date.now()}_${randomBytes(4).toString('hex')}`;
if (!/^[a-z_][a-z0-9_]*$/.test(tempDatabase)) {
  throw new Error('Generated temporary database name is invalid.');
}

const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const adminDatabase = process.env.DB_ADMIN_DATABASE || 'postgres';
const baseConnection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

async function withClient(database, run) {
  const client = new Client({ ...baseConnection, database });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

function runCommand(args, environment) {
  const configuredEntrypoint = process.env.npm_execpath;
  const windowsEntrypoint = join(
    process.env.APPDATA || '',
    'npm',
    'node_modules',
    'pnpm',
    'bin',
    'pnpm.mjs',
  );
  const pnpmScript = configuredEntrypoint || windowsEntrypoint;
  const useNodeEntrypoint =
    existsSync(pnpmScript) && /\.(?:cjs|mjs|js)$/i.test(pnpmScript);
  const command = useNodeEntrypoint
    ? process.execPath
    : process.platform === 'win32'
      ? 'pnpm.cmd'
      : 'pnpm';
  const commandArgs = useNodeEntrypoint ? [pnpmScript, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    env: environment,
    shell: !useNodeEntrypoint && process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(' ')} exited with ${result.status}.`,
    );
  }
}

let created = false;
try {
  await withClient(adminDatabase, (client) =>
    client.query(`create database ${identifier(tempDatabase)}`),
  );
  created = true;
  console.log(`Created disposable database ${tempDatabase}.`);

  const environment = { ...process.env, DB_NAME: tempDatabase };
  runCommand(['migrate:latest'], environment);
  runCommand(['exec', 'kysely', 'migrate', 'rollback', '--all'], environment);
  runCommand(['migrate:latest'], environment);
  runCommand(['migrate:list'], environment);
  console.log('Migration release contract passed: up -> rollback-all -> up.');
} finally {
  if (created) {
    await withClient(adminDatabase, (client) =>
      client.query(`drop database if exists ${identifier(tempDatabase)} with (force)`),
    );
    console.log(`Dropped disposable database ${tempDatabase}.`);
  }
}
