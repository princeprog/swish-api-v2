import 'dotenv/config';

import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import argon2 from 'argon2';
import { Client } from 'pg';

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required database environment variable: ${key}`);
  }
}

const args = new Set(process.argv.slice(2));
const keepDatabase = args.has('--keep');
const suffix = `${Date.now()}_${randomBytes(4).toString('hex')}`;
const databaseName = `swish_browser_${suffix}`;
const password = process.env.LIVE_PILOT_PASSWORD ?? 'LivePilotPassword123!';

if (!/^[a-z_][a-z0-9_]*$/.test(databaseName)) {
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

function runMigrations() {
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
  const commandArgs = useNodeEntrypoint
    ? [pnpmScript, 'migrate:latest']
    : ['migrate:latest'];
  const result = spawnSync(command, commandArgs, {
    env: { ...process.env, DB_NAME: databaseName },
    shell: !useNodeEntrypoint && process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(' ')} exited with ${result.status}.`,
    );
  }
}

async function seedDatabase() {
  const client = new Client({ ...baseConnection, database: databaseName });
  await client.connect();
  const query = (text, values = []) => client.query(text, values);
  const ids = {
    organization: randomUUID(),
    season: randomUUID(),
    venue: randomUUID(),
    ownerUser: randomUUID(),
    scorekeeperUser: randomUUID(),
    statisticianUser: randomUUID(),
    ownerMember: randomUUID(),
    scorekeeperMember: randomUUID(),
    statisticianMember: randomUUID(),
    crossoverDivision: randomUUID(),
    directDivision: randomUUID(),
    crossoverFormat: randomUUID(),
    directFormat: randomUUID(),
    crossoverPools: [randomUUID(), randomUUID()],
  };
  const emails = {
    owner: `browser-owner-${suffix}@example.test`,
    scorekeeper: `browser-scorekeeper-${suffix}@example.test`,
    statistician: `browser-statistician-${suffix}@example.test`,
  };
  const organizationSlug = `browser-tournament-${suffix}`;
  const seasonSlug = `browser-season-${suffix}`;
  const crossoverTeams = Array.from({ length: 8 }, () => randomUUID());
  const directTeams = Array.from({ length: 8 }, () => randomUUID());
  const allTeams = [...crossoverTeams, ...directTeams];

  try {
    await query('begin');
    const passwordHash = await argon2.hash(password);

    await query(
      `insert into auth.users (id, email, name, email_verified)
       values ($1, $2, 'Browser Pilot Owner', true),
              ($3, $4, 'Browser Pilot Scorekeeper', true),
              ($5, $6, 'Browser Pilot Statistician', true)`,
      [
        ids.ownerUser,
        emails.owner,
        ids.scorekeeperUser,
        emails.scorekeeper,
        ids.statisticianUser,
        emails.statistician,
      ],
    );
    await query(
      `insert into auth.password_credentials (user_id, password_hash)
       values ($1, $4), ($2, $4), ($3, $4)`,
      [ids.ownerUser, ids.scorekeeperUser, ids.statisticianUser, passwordHash],
    );
    await query(
      `insert into admin.organizations (id, name, slug)
       values ($1, 'Browser Tournament League', $2)`,
      [ids.organization, organizationSlug],
    );
    await query(
      `insert into admin.organization_members
       (id, organization_id, user_id, role, status)
       values ($1, $4, $5, 'owner', 'active'),
              ($2, $4, $6, 'scorekeeper', 'active'),
              ($3, $4, $7, 'statistician', 'active')`,
      [
        ids.ownerMember,
        ids.scorekeeperMember,
        ids.statisticianMember,
        ids.organization,
        ids.ownerUser,
        ids.scorekeeperUser,
        ids.statisticianUser,
      ],
    );
    await query(
      `insert into admin.league_seasons
       (id, organization_id, name, slug, public_enabled, status,
        schedule_slot_duration_minutes, default_qualifying_format,
        default_playoff_format, default_pool_count, default_qualifiers_per_pool,
        default_tiebreakers, default_crossover_template)
       values ($1, $2, 'Browser Tournament Season', $3, true, 'active', 90,
               'single_round_robin', 'single_elimination', 2, 2,
               $4::jsonb, $5::jsonb)`,
      [
        ids.season,
        ids.organization,
        seasonSlug,
        JSON.stringify([
          'win_percentage',
          'head_to_head',
          'point_differential',
          'points_for',
          'manual_decision',
        ]),
        JSON.stringify([
          { awaySeed: 'B2', homeSeed: 'A1' },
          { awaySeed: 'A2', homeSeed: 'B1' },
        ]),
      ],
    );
    await query(
      `insert into admin.league_season_game_rules
       (league_season_id, overtime_duration_ms, period_duration_ms,
        personal_foul_limit, regulation_periods, shot_clock_enabled,
        shot_clock_full_ms, shot_clock_short_ms, team_fouls_before_penalty,
        timeouts_first_half, timeouts_per_overtime, timeouts_second_half)
       values ($1, 300000, 60000, 5, 4, false, 24000, 14000, 5, 3, 1, 3)`,
      [ids.season],
    );
    await query(
      `insert into admin.venues (id, league_season_id, name, slug)
       values ($1, $2, 'Browser Pilot Court', $3)`,
      [ids.venue, ids.season, `browser-pilot-court-${suffix}`],
    );

    await query(
      `insert into admin.divisions (id, league_season_id, name, slug, status)
       values ($1, $3, 'Crossover Division', $4, 'active'),
              ($2, $3, 'Double Elimination Division', $5, 'active')`,
      [
        ids.crossoverDivision,
        ids.directDivision,
        ids.season,
        `crossover-${suffix}`,
        `double-elimination-${suffix}`,
      ],
    );
    await query(
      `insert into admin.division_roster_settings (division_id)
       values ($1), ($2)`,
      [ids.crossoverDivision, ids.directDivision],
    );
    await query(
      `insert into competition.division_formats
       (id, division_id, qualifying_format, playoff_format, pool_count,
        qualifiers_per_pool, tiebreakers, crossover_template, status, revision)
       values ($1, $3, 'single_round_robin', 'single_elimination', 2, 2,
               $5::jsonb, $6::jsonb, 'draft', 1),
              ($2, $4, 'none', 'double_elimination', 1, 1,
               $5::jsonb, '[]'::jsonb, 'draft', 1)`,
      [
        ids.crossoverFormat,
        ids.directFormat,
        ids.crossoverDivision,
        ids.directDivision,
        JSON.stringify([
          'win_percentage',
          'head_to_head',
          'point_differential',
          'points_for',
          'manual_decision',
        ]),
        JSON.stringify([
          { awaySeed: 'B2', homeSeed: 'A1' },
          { awaySeed: 'A2', homeSeed: 'B1' },
        ]),
      ],
    );
    await query(
      `insert into competition.pools (id, division_format_id, name, code, sort_order)
       values ($1, $3, 'Pool A', 'A', 1),
              ($2, $3, 'Pool B', 'B', 2),
              ($4, $5, 'Direct Seeds', 'A', 1)`,
      [
        ids.crossoverPools[0],
        ids.crossoverPools[1],
        ids.crossoverFormat,
        randomUUID(),
        ids.directFormat,
      ],
    );

    const teamRows = allTeams.map((teamId, index) => {
      const direct = index >= crossoverTeams.length;
      const localIndex = direct ? index - crossoverTeams.length : index;
      return [
        teamId,
        direct ? ids.directDivision : ids.crossoverDivision,
        `${direct ? 'Direct' : 'Pool'} Team ${localIndex + 1}`,
        `${direct ? 'direct' : 'pool'}-team-${localIndex + 1}-${suffix}`,
        direct ? '#16a34a' : localIndex < 4 ? '#2563eb' : '#dc2626',
      ];
    });
    await query(
      `insert into admin.teams (id, division_id, name, slug, color)
       select * from unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[])`,
      teamRows.reduce(
        (columns, row) =>
          columns.map((column, index) => [...column, row[index]]),
        [[], [], [], [], []],
      ),
    );
    await query(
      `insert into competition.pool_teams (pool_id, team_id, seed)
       select $1::uuid, unnest($3::uuid[]), generate_series(1, 4)
       union all
       select $2::uuid, unnest($4::uuid[]), generate_series(1, 4)`,
      [
        ids.crossoverPools[0],
        ids.crossoverPools[1],
        crossoverTeams.slice(0, 4),
        crossoverTeams.slice(4),
      ],
    );

    for (const [index, teamId] of allTeams.entries()) {
      const playerId = randomUUID();
      const rosterId = randomUUID();
      const versionId = randomUUID();
      const direct = index >= crossoverTeams.length;
      const localIndex = direct ? index - crossoverTeams.length : index;
      const teamName = `${direct ? 'Direct' : 'Pool'} Team ${localIndex + 1}`;
      const playerName = `${teamName} Captain`;
      await query(
        `insert into admin.players (id, team_id, name, jersey_number, position)
         values ($1, $2, $3, '1', 'Guard')`,
        [playerId, teamId, playerName],
      );
      await query(
        `insert into admin.team_rosters
         (id, team_id, workflow_status, latest_approved_version_id,
          published_version_id, published_at)
         values ($1, $2, 'published', null, null, null)`,
        [rosterId, teamId],
      );
      await query(
        `insert into admin.roster_versions
         (id, team_roster_id, version_number, approved_by_member_id, approved_at)
         values ($1, $2, 1, $3, now())`,
        [versionId, rosterId, ids.ownerMember],
      );
      await query(
        `insert into admin.roster_version_players
         (roster_version_id, source_player_id, name, jersey_number, position, sort_order)
         values ($1, $2, $3, '1', 'Guard', 1)`,
        [versionId, playerId, playerName],
      );
      await query(
        `update admin.team_rosters
         set latest_approved_version_id = $1,
             published_version_id = $1,
             published_at = now()
         where id = $2`,
        [versionId, rosterId],
      );
    }
    await query('commit');
  } catch (error) {
    await query('rollback');
    throw error;
  } finally {
    await client.end();
  }

  return {
    database: databaseName,
    organizationId: ids.organization,
    organizationSlug,
    seasonSlug,
    crossoverDivisionId: ids.crossoverDivision,
    crossoverDivisionSlug: `crossover-${suffix}`,
    directDivisionId: ids.directDivision,
    directDivisionSlug: `double-elimination-${suffix}`,
    venueId: ids.venue,
    ownerEmail: emails.owner,
    ownerPassword: password,
    scorekeeperEmail: emails.scorekeeper,
    scorekeeperPassword: password,
    statisticianEmail: emails.statistician,
    statisticianPassword: password,
    scorekeeperMemberId: ids.scorekeeperMember,
    statisticianMemberId: ids.statisticianMember,
    directTeamIds: directTeams,
  };
}

let created = false;
try {
  await withClient(adminDatabase, (client) =>
    client.query(`create database ${identifier(databaseName)}`),
  );
  created = true;
  console.log(`Created disposable database ${databaseName}.`);
  runMigrations();
  const fixture = await seedDatabase();
  console.log(JSON.stringify(fixture, null, 2));
  if (keepDatabase) {
    console.log('Keeping the disposable database because --keep was supplied.');
  }
} finally {
  if (created && !keepDatabase) {
    await withClient(adminDatabase, (client) =>
      client.query(
        `drop database if exists ${identifier(databaseName)} with (force)`,
      ),
    );
    console.log(`Dropped disposable database ${databaseName}.`);
  }
}
