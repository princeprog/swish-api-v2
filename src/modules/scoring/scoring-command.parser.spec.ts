import { BadRequestException } from '@nestjs/common';
import {
  SCORING_COMMAND_TYPES,
  parseScoringCommand,
} from './scoring-command.parser';

const id = '550e8400-e29b-41d4-a716-446655440000';

describe('parseScoringCommand', () => {
  it.each([
    ['game.start', { type: 'game.start' }],
    ['clocks.start', { type: 'clocks.start' }],
    ['clocks.pause', { type: 'clocks.pause' }],
    ['shot_clock.start', { type: 'shot_clock.start' }],
    ['shot_clock.pause', { type: 'shot_clock.pause' }],
    ['period.start', { type: 'period.start' }],
    ['game.finalize', { type: 'game.finalize' }],
  ])('accepts %s without a payload', (_type, command) => {
    expect(parseScoringCommand({ ...command, idempotencyKey: 'command-1' })).toEqual({
      ...command,
      idempotencyKey: 'command-1',
    });
  });

  it('accepts every supported payload shape', () => {
    const commands = [
      {
        type: 'game.configure',
        payload: { periodDurationMs: 600_000, overtimeDurationMs: 300_000 },
      },
      {
        type: 'game_clock.adjust',
        payload: { remainingMs: 1000, reason: 'Clock correction' },
      },
      { type: 'shot_clock.reset', payload: { resetTo: 'short' } },
      {
        type: 'shot_clock.adjust',
        payload: { remainingMs: 14_000, reason: 'Shot clock correction' },
      },
      { type: 'score.record', payload: { teamId: id, points: 3 } },
      { type: 'team_foul.record', payload: { teamId: id } },
      { type: 'personal_foul.record', payload: { teamId: id, playerId: id } },
      { type: 'timeout.record', payload: { teamId: id } },
      { type: 'event.reverse', payload: { eventId: id, reason: 'Undo' } },
      { type: 'period.end', payload: { reason: 'Period correction' } },
      { type: 'game.reopen', payload: { reason: 'Correct the final score' } },
    ];

    for (const command of commands) {
      expect(
        parseScoringCommand({ ...command, idempotencyKey: `command-${command.type}` }),
      ).toEqual({ ...command, idempotencyKey: `command-${command.type}` });
    }
  });

  it('publishes one closed command-type list', () => {
    expect(SCORING_COMMAND_TYPES).toEqual([
      'game.configure',
      'game.start',
      'clocks.start',
      'clocks.pause',
      'game_clock.adjust',
      'shot_clock.start',
      'shot_clock.pause',
      'shot_clock.reset',
      'shot_clock.adjust',
      'score.record',
      'team_foul.record',
      'personal_foul.record',
      'timeout.record',
      'event.reverse',
      'period.end',
      'period.start',
      'game.finalize',
      'game.reopen',
    ]);
  });

  it.each([
    [{ idempotencyKey: 'command-1', type: 'unknown' }],
    [{ idempotencyKey: '', type: 'game.start' }],
    [{ idempotencyKey: '   ', type: 'game.start' }],
    [{ idempotencyKey: 'command-1', type: 'game.start', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'clocks.start', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'clocks.pause', payload: [] }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.start', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.pause', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'period.start', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'game.finalize', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'game.start', extra: true }],
    [
      {
        idempotencyKey: 'command-1',
        type: 'game_clock.adjust',
        payload: { remainingMs: 1000, reason: 'Correction', extra: true },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'game_clock.adjust',
        payload: { remainingMs: -1, reason: 'Correction' },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'game_clock.adjust',
        payload: { remainingMs: 1000.5, reason: 'Correction' },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'score.record',
        payload: { teamId: 'team-1', points: 2 },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'score.record',
        payload: { teamId: id, points: 4 },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'shot_clock.reset',
        payload: { resetTo: 'fuller' },
      },
    ],
    [
      {
        idempotencyKey: 'command-1',
        type: 'game.reopen',
        payload: { reason: '   ' },
      },
    ],
    [{ idempotencyKey: 'command-1', type: 'game.configure' }],
    [{ idempotencyKey: 'command-1', type: 'game.configure', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'game.configure', payload: [] }],
    [{ idempotencyKey: 'command-1', type: 'game.configure', payload: { periodDurationMs: 1000, extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'game.configure', payload: { periodDurationMs: 1.5 } }],
    [{ idempotencyKey: 'command-1', type: 'game_clock.adjust', payload: { remainingMs: 1000 } }],
    [{ idempotencyKey: 'command-1', type: 'game_clock.adjust', payload: null }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.adjust', payload: { reason: 'Correction' } }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.adjust', payload: { remainingMs: 1000, reason: 2 } }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.reset', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'shot_clock.reset', payload: { resetTo: 'full', extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'score.record', payload: { teamId: id } }],
    [{ idempotencyKey: 'command-1', type: 'score.record', payload: 'score' }],
    [{ idempotencyKey: 'command-1', type: 'score.record', payload: { teamId: id, points: 2, extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'team_foul.record', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'team_foul.record', payload: id }],
    [{ idempotencyKey: 'command-1', type: 'personal_foul.record', payload: { teamId: id } }],
    [{ idempotencyKey: 'command-1', type: 'personal_foul.record', payload: { teamId: id, playerId: 1 } }],
    [{ idempotencyKey: 'command-1', type: 'timeout.record', payload: { teamId: id, extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'timeout.record', payload: null }],
    [{ idempotencyKey: 'command-1', type: 'event.reverse', payload: { eventId: id, extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'event.reverse', payload: { reason: 'Undo' } }],
    [{ idempotencyKey: 'command-1', type: 'event.reverse', payload: id }],
    [{ idempotencyKey: 'command-1', type: 'period.end', payload: { reason: 4 } }],
    [{ idempotencyKey: 'command-1', type: 'period.end', payload: { reason: 'Undo', extra: true } }],
    [{ idempotencyKey: 'command-1', type: 'game.reopen', payload: {} }],
    [{ idempotencyKey: 'command-1', type: 'game.reopen', payload: 'reason' }],
  ])('rejects malformed command (%s)', (command) => {
    expect(() => parseScoringCommand(command)).toThrow(BadRequestException);
  });

  it('allows period end without a payload and event reversal without a reason', () => {
    expect(
      parseScoringCommand({ idempotencyKey: 'period-end', type: 'period.end' }),
    ).toEqual({ idempotencyKey: 'period-end', type: 'period.end' });
    expect(
      parseScoringCommand({
        idempotencyKey: 'reverse-latest',
        type: 'event.reverse',
        payload: { eventId: id },
      }),
    ).toEqual({
      idempotencyKey: 'reverse-latest',
      type: 'event.reverse',
      payload: { eventId: id },
    });
  });
});
