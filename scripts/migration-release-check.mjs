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

async function seedPopulatedDatabase(database) {
  await withClient(database, async (client) => {
    await client.query('begin');
    try {
      const user = await client.query(`
        insert into auth.users (email, name, email_verified)
        values ('migration-fixture@example.test', 'Migration Fixture', true)
        returning id
      `);
      const organization = await client.query(`
        insert into admin.organizations (name, slug)
        values ('Migration Fixture League', 'migration-fixture-league')
        returning id
      `);
      const organizationId = organization.rows[0].id;
      const member = await client.query(
        `
          insert into admin.organization_members (organization_id, user_id, role)
          values ($1, $2, 'owner')
          returning id
        `,
        [organizationId, user.rows[0].id],
      );
      const season = await client.query(
        `
          insert into admin.league_seasons (organization_id, name, slug)
          values ($1, 'Migration Fixture Season', 'migration-fixture-season')
          returning id
        `,
        [organizationId],
      );
      const seasonId = season.rows[0].id;
      await client.query(
        'insert into admin.league_season_game_rules (league_season_id) values ($1)',
        [seasonId],
      );
      const division = await client.query(
        `
          insert into admin.divisions (league_season_id, name, slug)
          values ($1, 'Open Division', 'open')
          returning id
        `,
        [seasonId],
      );
      const divisionId = division.rows[0].id;
      const teams = await client.query(
        `
          insert into admin.teams (division_id, name, slug)
          values ($1, 'Home', 'home'), ($1, 'Away', 'away')
          returning id, slug
        `,
        [divisionId],
      );
      const teamBySlug = new Map(teams.rows.map((row) => [row.slug, row.id]));
      const player = await client.query(
        `
          insert into admin.players (team_id, name, jersey_number)
          values ($1, 'Fixture Player', '1')
          returning id
        `,
        [teamBySlug.get('home')],
      );
      const venue = await client.query(
        `
          insert into admin.venues (league_season_id, name, slug)
          values ($1, 'Main Court', 'main-court')
          returning id
        `,
        [seasonId],
      );
      const format = await client.query(
        `
          insert into competition.division_formats (division_id)
          values ($1)
          returning id
        `,
        [divisionId],
      );
      const pool = await client.query(
        `
          insert into competition.pools (division_format_id, name, code, sort_order)
          values ($1, 'Pool A', 'A', 1)
          returning id
        `,
        [format.rows[0].id],
      );
      await client.query(
        `
          insert into competition.pool_teams (pool_id, team_id, seed)
          values ($1, $2, 1), ($1, $3, 2)
        `,
        [pool.rows[0].id, teamBySlug.get('home'), teamBySlug.get('away')],
      );
      const matchup = await client.query(
        `
          insert into competition.matchups (
            division_format_id, pool_id, stage, bracket_side, round_number,
            position, home_source_type, home_source_ref, away_source_type,
            away_source_ref, home_team_id, away_team_id, status, format_revision
          )
          values ($1::uuid, $2::uuid, 'qualifier', 'pool', 1, 1, 'team', $3::text,
                  'team', $4::text, $5::uuid, $6::uuid, 'ready', 1)
          returning id
        `,
        [
          format.rows[0].id,
          pool.rows[0].id,
          teamBySlug.get('home'),
          teamBySlug.get('away'),
          teamBySlug.get('home'),
          teamBySlug.get('away'),
        ],
      );
      const game = await client.query(
        `
          insert into competition.games (
            league_season_id, division_id, venue_id, home_team_id,
            away_team_id, starts_at, status, competition_kind, matchup_id
          )
          values ($1, $2, $3, $4, $5, now(), 'scheduled', 'stage', $6)
          returning id
        `,
        [
          seasonId,
          divisionId,
          venue.rows[0].id,
          teamBySlug.get('home'),
          teamBySlug.get('away'),
          matchup.rows[0].id,
        ],
      );
      const roster = await client.query(
        `
          insert into admin.team_rosters (team_id, workflow_status)
          values ($1, 'published')
          returning id
        `,
        [teamBySlug.get('home')],
      );
      const rosterVersion = await client.query(
        `
          insert into admin.roster_versions (team_roster_id, version_number, approved_by_member_id)
          values ($1, 1, $2)
          returning id
        `,
        [roster.rows[0].id, member.rows[0].id],
      );
      await client.query(
        `
          insert into admin.roster_version_players (
            roster_version_id, source_player_id, name, jersey_number, sort_order
          )
          values ($1, $2, 'Fixture Player', '1', 1)
        `,
        [rosterVersion.rows[0].id, player.rows[0].id],
      );
      await client.query(
        `
          update admin.team_rosters
          set latest_approved_version_id = $1,
              published_version_id = $1,
              published_at = now()
          where id = $2
        `,
        [rosterVersion.rows[0].id, roster.rows[0].id],
      );
      await client.query(
        `insert into scoring.game_states (game_id) values ($1)`,
        [game.rows[0].id],
      );
      await client.query('commit');
      console.log('Seeded populated migration fixture.');
    } catch (error) {
      await client.query('rollback');
      throw error;
    }
  });
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
  await seedPopulatedDatabase(tempDatabase);
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
