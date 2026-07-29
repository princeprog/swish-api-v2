import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('live game scoring migration', () => {
  const migrationSource = readFileSync(
    join(__dirname, 'migrations', '1785315447762_live_game_scoring.ts'),
    'utf8',
  );

  it('creates the scoring projection, event log, and control-session tables', () => {
    expect(migrationSource).toContain("createSchema('scoring')");
    expect(migrationSource).toContain("createTable('scoring.game_states')");
    expect(migrationSource).toContain("createTable('scoring.game_events')");
    expect(migrationSource).toContain(
      "createTable('scoring.game_control_sessions')",
    );
  });

  it('adds idempotent ordered events and append-only protection', () => {
    expect(migrationSource).toContain('game_events_game_sequence_unique');
    expect(migrationSource).toContain('game_events_game_idempotency_unique');
    expect(migrationSource).toContain('prevent_game_event_mutation_trigger');
    expect(migrationSource).toContain('Cannot update or delete scoring events');
  });

  it('enforces nonnegative basketball state and one active scoring controller', () => {
    expect(migrationSource).toContain('game_states_nonnegative_values_check');
    expect(migrationSource).toContain(
      'game_control_sessions_one_active_per_game',
    );
    expect(migrationSource).toContain('where released_at is null');
  });

  it('drops scoring objects in reverse dependency order', () => {
    const downStart = migrationSource.indexOf('export async function down');
    const downSource = migrationSource.slice(downStart);

    expect(
      downSource.indexOf("dropTable('scoring.game_control_sessions')"),
    ).toBeLessThan(downSource.indexOf("dropTable('scoring.game_events')"));
    expect(downSource.indexOf("dropTable('scoring.game_events')")).toBeLessThan(
      downSource.indexOf("dropTable('scoring.game_states')"),
    );
    expect(downSource).toContain("dropSchema('scoring')");
  });
});
