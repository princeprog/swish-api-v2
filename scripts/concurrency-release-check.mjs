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

const tempDatabase = `swish_concurrency_${Date.now()}_${randomBytes(4).toString('hex')}`;
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

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArgs.join(' ')} exited with ${result.status}.`,
    );
  }
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function assertBlockedUntilCommit({ first, second, insert }) {
  await first.query('begin');
  await second.query('begin');

  await insert(first);

  let secondSettled = false;
  let secondError;
  const secondInsert = insert(second)
    .then(() => {
      secondSettled = true;
    })
    .catch((error) => {
      secondSettled = true;
      secondError = error;
    });

  await wait(150);
  if (secondSettled) {
    throw new Error('The second concurrent write was not held by the lock.');
  }

  await first.query('commit');
  await secondInsert;
  await second.query('rollback');

  if (!secondError || secondError.code !== '23505') {
    throw new Error(
      `The second concurrent write did not fail with a uniqueness conflict (constraint: ${secondError?.constraint ?? 'unknown'}).`,
    );
  }

  return secondError.constraint;
}

async function seedFixture(client) {
  await client.query('begin');
  try {
    const userRows = await client.query(`
      insert into auth.users (email, name, email_verified)
      values ('concurrency-owner@example.test', 'Concurrency Owner', true),
             ('concurrency-scorekeeper@example.test', 'Concurrency Scorekeeper', true)
      returning id, email
    `);
    const userByEmail = new Map(
      userRows.rows.map((row) => [row.email, row.id]),
    );

    const organization = await client.query(`
      insert into admin.organizations (name, slug)
      values ('Concurrency League', 'concurrency-league')
      returning id
    `);
    const organizationId = organization.rows[0].id;
    const members = await client.query(
      `
        insert into admin.organization_members (organization_id, user_id, role)
        values ($1, $2, 'owner'), ($1, $3, 'scorekeeper')
        returning id, role
      `,
      [
        organizationId,
        userByEmail.get('concurrency-owner@example.test'),
        userByEmail.get('concurrency-scorekeeper@example.test'),
      ],
    );
    const memberByRole = new Map(
      members.rows.map((row) => [row.role, row.id]),
    );

    const season = await client.query(
      `
        insert into admin.league_seasons (organization_id, name, slug)
        values ($1, 'Concurrency Season', 'concurrency-season')
        returning id
      `,
      [organizationId],
    );
    const seasonId = season.rows[0].id;
    await client.query(
      `
        insert into admin.league_season_game_rules (league_season_id)
        values ($1)
      `,
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
    const venue = await client.query(
      `
        insert into admin.venues (league_season_id, name, slug)
        values ($1, 'Main Court', 'main-court')
        returning id
      `,
      [seasonId],
    );
    const venueId = venue.rows[0].id;
    const game = await client.query(
      `
        insert into competition.games (
          league_season_id, division_id, venue_id, home_team_id, away_team_id,
          starts_at, status, competition_kind
        )
        values ($1, $2, $3, $4, $5, now(), 'live', 'exhibition')
        returning id
      `,
      [
        seasonId,
        divisionId,
        venueId,
        teamBySlug.get('home'),
        teamBySlug.get('away'),
      ],
    );
    const gameId = game.rows[0].id;

    const snapshot = await client.query(
      `
        insert into scoring.game_roster_snapshots (game_id, team_id)
        values ($1, $2), ($1, $3)
        returning id, team_id
      `,
      [gameId, teamBySlug.get('home'), teamBySlug.get('away')],
    );
    const homeSnapshot = snapshot.rows.find(
      (row) => row.team_id === teamBySlug.get('home'),
    );
    const homePlayer = await client.query(
      `
        insert into scoring.game_roster_players (
          game_roster_snapshot_id, name, jersey_number, sort_order
        )
        values ($1, 'Home Player', '1', 1)
        returning id
      `,
      [homeSnapshot.id],
    );
    const sheet = await client.query(
      `
        insert into statistics.game_stat_sheets (game_id)
        values ($1)
        returning id
      `,
      [gameId],
    );
    const scoreEvent = await client.query(
      `
        insert into scoring.game_events (
          game_id, actor_member_id, sequence, type, period_number,
          overtime_number, game_clock_remaining_ms, shot_clock_remaining_ms,
          payload, idempotency_key
        )
        values ($1, $2, 1, 'score.record', 1, 0, 600000, 24000,
                '{"points": 2, "teamId": "fixture"}', 'score-target')
        returning id
      `,
      [gameId, memberByRole.get('scorekeeper')],
    );
    const statEvent = await client.query(
      `
        insert into statistics.stat_events (
          stat_sheet_id, game_id, game_roster_player_id, team_id,
          actor_member_id, type, value, sequence, idempotency_key
        )
        values ($1, $2, $3, $4, $5, 'points', 2, 1, 'stat-target')
        returning id
      `,
      [
        sheet.rows[0].id,
        gameId,
        homePlayer.rows[0].id,
        teamBySlug.get('home'),
        memberByRole.get('scorekeeper'),
      ],
    );

    await client.query('commit');
    return {
      gameId,
      memberId: memberByRole.get('scorekeeper'),
      scoreEventId: scoreEvent.rows[0].id,
      statEventId: statEvent.rows[0].id,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

async function runChecks(database) {
  const fixture = await withClient(database, seedFixture);
  const first = new Client({ ...baseConnection, database });
  const second = new Client({ ...baseConnection, database });
  await Promise.all([first.connect(), second.connect()]);

  try {
    await first.query('begin');
    await first.query(
      'select id from competition.games where id = $1 for update',
      [fixture.gameId],
    );
    await second.query('begin');
    let lockReleased = false;
    const update = second
      .query('update competition.games set updated_at = now() where id = $1', [
        fixture.gameId,
      ])
      .then(() => {
        lockReleased = true;
      });
    await wait(150);
    if (lockReleased) {
      throw new Error('A game update bypassed the held row lock.');
    }
    await first.query('commit');
    await update;
    await second.query('rollback');

    const controlConstraint = await assertBlockedUntilCommit({
      first,
      second,
      insert: (client) =>
        client.query(
          `
            insert into scoring.game_control_sessions (
              game_id, organization_member_id, control_token_hash, expires_at
            )
            values ($1::uuid, $2::uuid, $3::text, now() + interval '2 minutes')
          `,
          [fixture.gameId, fixture.memberId, randomBytes(32).toString('hex')],
        ),
    });
    if (controlConstraint !== 'game_control_sessions_one_active_per_game') {
      throw new Error(`Unexpected control constraint: ${controlConstraint}`);
    }

    const scoringReversalConstraint = await assertBlockedUntilCommit({
      first,
      second,
      insert: (client) =>
        client.query(
          `
            insert into scoring.game_events (
              game_id, actor_member_id, sequence, type, period_number,
              overtime_number, game_clock_remaining_ms, shot_clock_remaining_ms,
              payload, reverses_event_id, idempotency_key
            )
            values ($1::uuid, $2::uuid, $3::integer, 'event.reverse', 1, 0,
                    600000, 24000, '{"eventId": "reversal"}', $4::uuid, $5::text)
          `,
          [
            fixture.gameId,
            fixture.memberId,
            2 + Math.floor(Math.random() * 100000),
            fixture.scoreEventId,
            `score-reversal-${randomBytes(4).toString('hex')}`,
          ],
        ),
    });
    if (
      scoringReversalConstraint !==
      'scoring_game_events_one_reversal_per_event'
    ) {
      throw new Error(
        `Unexpected scoring reversal constraint: ${scoringReversalConstraint}`,
      );
    }

    const statReversalConstraint = await assertBlockedUntilCommit({
      first,
      second,
      insert: (client) =>
        client.query(
          `
            insert into statistics.stat_events (
              stat_sheet_id, game_id, game_roster_player_id, team_id,
              actor_member_id, type, value, sequence, reverses_event_id,
              idempotency_key
            )
            select stat_sheet_id, game_id, game_roster_player_id, team_id,
                   actor_member_id, 'turnover', 1, $2::integer, $3::uuid, $4::text
            from statistics.stat_events
            where id = $1::uuid
          `,
          [
            fixture.statEventId,
            2 + Math.floor(Math.random() * 100000),
            fixture.statEventId,
            `stat-reversal-${randomBytes(4).toString('hex')}`,
          ],
        ),
    });
    if (
      statReversalConstraint !==
      'statistics_stat_events_one_reversal_per_event'
    ) {
      throw new Error(
        `Unexpected statistic reversal constraint: ${statReversalConstraint}`,
      );
    }

    console.log(
      'Concurrency release contract passed: row locks, active control, and score/stat reversal writes serialize correctly.',
    );
  } finally {
    await Promise.allSettled([
      first.query('rollback'),
      second.query('rollback'),
    ]);
    await Promise.all([first.end(), second.end()]);
  }
}

let created = false;
try {
  await withClient(adminDatabase, (client) =>
    client.query(`create database ${identifier(tempDatabase)}`),
  );
  created = true;
  console.log(`Created disposable database ${tempDatabase}.`);
  runCommand(['migrate:latest'], { ...process.env, DB_NAME: tempDatabase });
  await runChecks(tempDatabase);
} finally {
  if (created) {
    await withClient(adminDatabase, (client) =>
      client.query(
        `drop database if exists ${identifier(tempDatabase)} with (force)`,
      ),
    );
    console.log(`Dropped disposable database ${tempDatabase}.`);
  }
}
