import { BadRequestException } from '@nestjs/common';
import type { ScoringCommand } from './scoring-engine';

export const SCORING_COMMAND_TYPES = [
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
] as const satisfies readonly ScoringCommand['type'][];

const COMMAND_TYPE_SET = new Set<string>(SCORING_COMMAND_TYPES);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 400;
const MAX_IDEMPOTENCY_KEY_LENGTH = 120;
const MAX_DURATION_MS = 86_400_000;

type CommandRecord = Record<string, unknown>;

/**
 * Parse the command object immediately before it reaches scoring state or the
 * database. This remains necessary for internal callers that bypass Nest's
 * controller ValidationPipe.
 */
export function parseScoringCommand(value: unknown): ScoringCommand {
  const command = asRecord(value, 'scoring command');
  assertExactKeys(command, ['idempotencyKey', 'type', 'payload'], 'scoring command');

  const idempotencyKey = requiredString(
    command.idempotencyKey,
    'idempotencyKey',
    MAX_IDEMPOTENCY_KEY_LENGTH,
  );
  const type = requiredString(command.type, 'command type', 80);

  if (!COMMAND_TYPE_SET.has(type)) {
    invalid('This scoring action is not supported.');
  }

  const commandType = type as ScoringCommand['type'];
  const payload = command.payload;
  switch (commandType) {
    case 'game.configure':
      return withBase(idempotencyKey, commandType, optionalDurations(payload));
    case 'game.start':
    case 'clocks.start':
    case 'clocks.pause':
    case 'shot_clock.start':
    case 'shot_clock.pause':
    case 'period.start':
    case 'game.finalize':
      assertNoPayload(payload, commandType);
      return withBase(idempotencyKey, commandType);
    case 'game_clock.adjust':
      return withBase(idempotencyKey, commandType, adjustPayload(payload, 'game clock'));
    case 'shot_clock.adjust':
      return withBase(idempotencyKey, commandType, adjustPayload(payload, 'shot clock'));
    case 'shot_clock.reset': {
      const body = exactPayload(payload, ['resetTo'], commandType);
      if (body.resetTo !== 'full' && body.resetTo !== 'short') {
        invalid('Choose a full or short shot clock reset.');
      }
      return withBase(idempotencyKey, commandType, { resetTo: body.resetTo });
    }
    case 'score.record': {
      const body = exactPayload(payload, ['teamId', 'points'], commandType);
      const teamId = uuid(body.teamId, 'teamId');
      if (body.points !== 1 && body.points !== 2 && body.points !== 3) {
        invalid('Choose a score worth 1, 2, or 3 points.');
      }
      return withBase(idempotencyKey, commandType, { teamId, points: body.points });
    }
    case 'team_foul.record':
    case 'timeout.record': {
      const body = exactPayload(payload, ['teamId'], commandType);
      return withBase(idempotencyKey, commandType, { teamId: uuid(body.teamId, 'teamId') });
    }
    case 'personal_foul.record': {
      const body = exactPayload(payload, ['teamId', 'playerId'], commandType);
      return withBase(idempotencyKey, commandType, {
        teamId: uuid(body.teamId, 'teamId'),
        playerId: uuid(body.playerId, 'playerId'),
      });
    }
    case 'event.reverse': {
      const body = asRecord(payload, `${type} payload`);
      assertExactKeys(body, ['eventId', 'reason'], `${commandType} payload`);
      if (!('eventId' in body)) invalid('Choose the event to reverse.');
      const eventId = uuid(body.eventId, 'eventId');
      const reason = optionalReason(body.reason, 'reason');
      return withBase(
        idempotencyKey,
        commandType,
        reason === undefined ? { eventId } : { eventId, reason },
      );
    }
    case 'period.end': {
      if (payload === undefined) return withBase(idempotencyKey, commandType);
      const body = asRecord(payload, `${commandType} payload`);
      assertExactKeys(body, ['reason'], `${commandType} payload`);
      const reason = optionalReason(body.reason, 'reason');
      return withBase(
        idempotencyKey,
        commandType,
        reason === undefined ? {} : { reason },
      );
    }
    case 'game.reopen': {
      const body = exactPayload(payload, ['reason'], commandType);
      return withBase(idempotencyKey, commandType, {
        reason: requiredString(body.reason, 'reason', MAX_REASON_LENGTH),
      });
    }
    default:
      return assertNever(commandType);
  }
}

function optionalDurations(value: unknown): Record<string, number> | undefined {
  if (value === undefined) {
    invalid('This scoring action is missing required information.');
  }
  const body = asRecord(value, 'game.configure payload');
  assertExactKeys(
    body,
    [
      'overtimeDurationMs',
      'periodDurationMs',
      'shotClockFullMs',
      'shotClockShortMs',
    ],
    'game.configure payload',
  );
  const result: Record<string, number> = {};
  for (const field of [
    'overtimeDurationMs',
    'periodDurationMs',
    'shotClockFullMs',
    'shotClockShortMs',
  ] as const) {
    if (body[field] !== undefined) {
      result[field] = nonnegativeInteger(body[field], field, MAX_DURATION_MS);
      if (result[field] === 0) invalid('Enter valid clock durations.');
    }
  }
  if (Object.keys(result).length === 0) {
    invalid('This scoring action is missing required information.');
  }
  return result;
}

function adjustPayload(value: unknown, label: string) {
  const body = exactPayload(value, ['remainingMs', 'reason'], `${label} adjustment`);
  return {
    remainingMs: nonnegativeInteger(body.remainingMs, 'remainingMs', MAX_DURATION_MS),
    reason: requiredString(body.reason, 'reason', MAX_REASON_LENGTH),
  };
}

function exactPayload(
  value: unknown,
  allowedKeys: readonly string[],
  label: string,
): CommandRecord {
  const body = asRecord(value, `${label} payload`);
  assertExactKeys(body, allowedKeys, `${label} payload`);
  for (const key of allowedKeys) {
    if (!(key in body)) invalid('This scoring action is missing required information.');
  }
  return body;
}

function assertNoPayload(value: unknown, type: string) {
  if (value !== undefined) invalid('This scoring action contains unsupported information.');
}

function assertExactKeys(
  value: CommandRecord,
  allowedKeys: readonly string[],
  label: string,
) {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid('This scoring action contains unsupported information.');
  }
}

function asRecord(value: unknown, label: string): CommandRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('This scoring action is missing required information.');
  }
  return value as CommandRecord;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(field === 'reason' ? 'Add a reason for this scoring change.' : 'Enter a valid scoring request reference.');
  }
  if (value.length > maxLength) {
    invalid(field === 'reason' ? 'The reason is too long.' : 'The scoring request reference is too long.');
  }
  return value;
}

function optionalReason(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, MAX_REASON_LENGTH);
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    invalid('Choose a valid team, player, or event.');
  }
  return value;
}

function nonnegativeInteger(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    invalid('Enter a whole-number clock value.');
  }
  return value;
}

function withBase(
  idempotencyKey: string,
  type: ScoringCommand['type'],
  payload?: unknown,
): ScoringCommand {
  return payload === undefined
    ? ({ idempotencyKey, type } as ScoringCommand)
    : ({ idempotencyKey, type, payload } as ScoringCommand);
}

function invalid(message: string): never {
  throw new BadRequestException(message);
}

function assertNever(value: never): never {
  void value;
  invalid('This scoring action is not supported.');
}
