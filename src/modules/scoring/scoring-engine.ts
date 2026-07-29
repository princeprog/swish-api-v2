import { randomUUID } from 'node:crypto';

export const SCORING_DEFAULTS = {
  overtimeDurationMs: 5 * 60 * 1000,
  periodDurationMs: 10 * 60 * 1000,
  regulationPeriods: 4,
  shotClockFullMs: 24 * 1000,
  shotClockShortMs: 14 * 1000,
} as const;

export type ScoringPhase =
  | 'pregame'
  | 'live'
  | 'paused'
  | 'period_break'
  | 'final'
  | 'reopened';

export type ScoringTeamSide = 'home' | 'away';

export type LatestReversibleScoringEvent = {
  id: string;
  payload: Record<string, unknown>;
  summary: string;
  type: 'score.record' | 'team_foul.record';
};

export type ScoringState = {
  awayScore: number;
  awayTeamFouls: number;
  awayTeamId: string;
  currentPeriodNumber: number;
  gameClockRemainingMs: number;
  gameClockRunning: boolean;
  gameClockStartedAt: Date | null;
  gameId: string;
  homeScore: number;
  homeTeamFouls: number;
  homeTeamId: string;
  latestReversibleEvent: LatestReversibleScoringEvent | null;
  overtimeDurationMs: number;
  overtimeNumber: number;
  periodDurationMs: number;
  phase: ScoringPhase;
  regulationPeriods: number;
  sequence: number;
  shotClockFullMs: number;
  shotClockRemainingMs: number;
  shotClockRunning: boolean;
  shotClockShortMs: number;
  shotClockStartedAt: Date | null;
  version: number;
};

export type ScoringEventDraft = {
  gameClockRemainingMs: number;
  id: string;
  idempotencyKey: string;
  overtimeNumber: number;
  payload: Record<string, unknown>;
  periodNumber: number;
  reversesEventId: string | null;
  sequence: number;
  shotClockRemainingMs: number;
  type: ScoringCommand['type'];
};

type BaseCommand = {
  idempotencyKey: string;
};

export type ScoringCommand =
  | (BaseCommand & {
      payload?: {
        overtimeDurationMs?: number;
        periodDurationMs?: number;
        shotClockFullMs?: number;
        shotClockShortMs?: number;
      };
      type: 'game.configure';
    })
  | (BaseCommand & { type: 'game.start' })
  | (BaseCommand & { type: 'clocks.start' })
  | (BaseCommand & { type: 'clocks.pause' })
  | (BaseCommand & {
      payload: { remainingMs: number; reason: string };
      type: 'game_clock.adjust';
    })
  | (BaseCommand & { type: 'shot_clock.start' })
  | (BaseCommand & { type: 'shot_clock.pause' })
  | (BaseCommand & {
      payload: { resetTo: 'full' | 'short' };
      type: 'shot_clock.reset';
    })
  | (BaseCommand & {
      payload: { remainingMs: number; reason: string };
      type: 'shot_clock.adjust';
    })
  | (BaseCommand & {
      payload: { points: 1 | 2 | 3 | number; teamId: string };
      type: 'score.record';
    })
  | (BaseCommand & {
      payload: { teamId: string };
      type: 'team_foul.record';
    })
  | (BaseCommand & {
      payload: { eventId?: string | null; reason?: string };
      type: 'event.reverse';
    })
  | (BaseCommand & { payload?: { reason?: string }; type: 'period.end' })
  | (BaseCommand & { type: 'period.start' })
  | (BaseCommand & { type: 'game.finalize' })
  | (BaseCommand & { payload: { reason: string }; type: 'game.reopen' });

export class ScoringActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createInitialScoringState(params: {
  awayScore?: number | null;
  awayTeamId: string;
  gameId: string;
  homeScore?: number | null;
  homeTeamId: string;
  phase?: ScoringPhase;
}): ScoringState {
  return {
    awayScore: params.awayScore ?? 0,
    awayTeamFouls: 0,
    awayTeamId: params.awayTeamId,
    currentPeriodNumber: 1,
    gameClockRemainingMs: SCORING_DEFAULTS.periodDurationMs,
    gameClockRunning: false,
    gameClockStartedAt: null,
    gameId: params.gameId,
    homeScore: params.homeScore ?? 0,
    homeTeamFouls: 0,
    homeTeamId: params.homeTeamId,
    latestReversibleEvent: null,
    overtimeDurationMs: SCORING_DEFAULTS.overtimeDurationMs,
    overtimeNumber: 0,
    periodDurationMs: SCORING_DEFAULTS.periodDurationMs,
    phase: params.phase ?? 'pregame',
    regulationPeriods: SCORING_DEFAULTS.regulationPeriods,
    sequence: 0,
    shotClockFullMs: SCORING_DEFAULTS.shotClockFullMs,
    shotClockRemainingMs: SCORING_DEFAULTS.shotClockFullMs,
    shotClockRunning: false,
    shotClockShortMs: SCORING_DEFAULTS.shotClockShortMs,
    shotClockStartedAt: null,
    version: 0,
  };
}

export function applyScoringCommand(
  state: ScoringState,
  command: ScoringCommand,
  now: Date,
): { event: ScoringEventDraft; state: ScoringState } {
  const next = materializeClocks(state, now);
  const eventId = randomUUID();
  const eventPayload: Record<string, unknown> = commandPayload(command);
  let reversesEventId: string | null = null;

  switch (command.type) {
    case 'game.configure': {
      assertPregame(next);
      const periodDurationMs =
        command.payload?.periodDurationMs ?? next.periodDurationMs;
      const overtimeDurationMs =
        command.payload?.overtimeDurationMs ?? next.overtimeDurationMs;
      const shotClockFullMs =
        command.payload?.shotClockFullMs ?? next.shotClockFullMs;
      const shotClockShortMs =
        command.payload?.shotClockShortMs ?? next.shotClockShortMs;

      assertDurationRange('periodDurationMs', periodDurationMs, 60000, 1800000);
      assertDurationRange(
        'overtimeDurationMs',
        overtimeDurationMs,
        60000,
        1800000,
      );
      assertDurationRange('shotClockFullMs', shotClockFullMs, 1000, 99000);
      assertDurationRange('shotClockShortMs', shotClockShortMs, 1000, 99000);

      if (shotClockShortMs > shotClockFullMs) {
        throw new ScoringActionError(
          'SHOT_CLOCK_SHORT_EXCEEDS_FULL',
          'Short reset cannot exceed the full shot clock',
        );
      }

      next.periodDurationMs = periodDurationMs;
      next.overtimeDurationMs = overtimeDurationMs;
      next.shotClockFullMs = shotClockFullMs;
      next.shotClockShortMs = shotClockShortMs;
      next.gameClockRemainingMs = periodDurationMs;
      next.shotClockRemainingMs = shotClockFullMs;
      break;
    }
    case 'game.start':
    case 'clocks.start': {
      assertNotFinal(next);
      if (next.phase === 'period_break') {
        throw new ScoringActionError(
          'PERIOD_BREAK_ACTIVE',
          'Start the next period before starting the clock',
        );
      }
      next.phase = 'live';
      next.gameClockRunning = true;
      next.shotClockRunning = true;
      next.gameClockStartedAt = now;
      next.shotClockStartedAt = now;
      break;
    }
    case 'clocks.pause':
      assertNotFinal(next);
      next.phase = next.phase === 'pregame' ? 'pregame' : 'paused';
      next.gameClockRunning = false;
      next.shotClockRunning = false;
      next.gameClockStartedAt = null;
      next.shotClockStartedAt = null;
      break;
    case 'game_clock.adjust':
      assertReason(command.payload.reason);
      assertDurationRange(
        'gameClockRemainingMs',
        command.payload.remainingMs,
        0,
        currentPeriodDuration(next),
      );
      next.gameClockRemainingMs = command.payload.remainingMs;
      next.gameClockStartedAt = next.gameClockRunning ? now : null;
      break;
    case 'shot_clock.start':
      assertNotFinal(next);
      if (!next.gameClockRunning) {
        throw new ScoringActionError(
          'GAME_CLOCK_PAUSED',
          'Shot clock cannot run while the game clock is paused',
        );
      }
      next.shotClockRunning = true;
      next.shotClockStartedAt = now;
      break;
    case 'shot_clock.pause':
      next.shotClockRunning = false;
      next.shotClockStartedAt = null;
      break;
    case 'shot_clock.reset':
      next.shotClockRemainingMs =
        command.payload.resetTo === 'short'
          ? next.shotClockShortMs
          : next.shotClockFullMs;
      next.shotClockStartedAt = next.shotClockRunning ? now : null;
      break;
    case 'shot_clock.adjust':
      assertReason(command.payload.reason);
      assertDurationRange(
        'shotClockRemainingMs',
        command.payload.remainingMs,
        0,
        next.shotClockFullMs,
      );
      next.shotClockRemainingMs = command.payload.remainingMs;
      next.shotClockStartedAt = next.shotClockRunning ? now : null;
      break;
    case 'score.record': {
      const side = resolveTeamSide(next, command.payload.teamId);
      if (![1, 2, 3].includes(command.payload.points)) {
        throw new ScoringActionError(
          'INVALID_SCORE_VALUE',
          'Scores must be recorded as one, two, or three points',
        );
      }
      if (side === 'home') {
        next.homeScore += command.payload.points;
      } else {
        next.awayScore += command.payload.points;
      }
      next.latestReversibleEvent = {
        id: eventId,
        payload: command.payload,
        summary: `${capitalize(side)} +${command.payload.points}`,
        type: 'score.record',
      };
      break;
    }
    case 'team_foul.record': {
      const side = resolveTeamSide(next, command.payload.teamId);
      if (side === 'home') {
        next.homeTeamFouls += 1;
      } else {
        next.awayTeamFouls += 1;
      }
      next.latestReversibleEvent = {
        id: eventId,
        payload: command.payload,
        summary: `${capitalize(side)} team foul`,
        type: 'team_foul.record',
      };
      break;
    }
    case 'event.reverse': {
      const latestEvent = next.latestReversibleEvent;
      if (!latestEvent || latestEvent.id !== command.payload.eventId) {
        assertReason(command.payload.reason);
        throw new ScoringActionError(
          'REVERSAL_REQUIRES_REVIEW',
          'Older corrections require review and a reason',
        );
      }

      reverseLatestEvent(next, latestEvent);
      reversesEventId = latestEvent.id;
      next.latestReversibleEvent = null;
      break;
    }
    case 'period.end':
      assertNotFinal(next);
      if (next.gameClockRemainingMs > 0) {
        assertReason(command.payload?.reason);
      }
      next.phase = 'period_break';
      next.gameClockRunning = false;
      next.shotClockRunning = false;
      next.gameClockStartedAt = null;
      next.shotClockStartedAt = null;
      break;
    case 'period.start':
      assertNotFinal(next);
      if (next.phase !== 'period_break') {
        throw new ScoringActionError(
          'PERIOD_NOT_READY',
          'The current period must be ended before starting the next one',
        );
      }
      if (next.currentPeriodNumber < next.regulationPeriods) {
        next.currentPeriodNumber += 1;
      } else {
        next.overtimeNumber += 1;
      }
      next.homeTeamFouls = 0;
      next.awayTeamFouls = 0;
      next.gameClockRemainingMs = currentPeriodDuration(next);
      next.shotClockRemainingMs = next.shotClockFullMs;
      next.phase = 'paused';
      break;
    case 'game.finalize':
      assertFinalizable(next);
      next.phase = 'final';
      break;
    case 'game.reopen':
      assertReason(command.payload.reason);
      if (next.phase !== 'final') {
        throw new ScoringActionError(
          'GAME_NOT_FINAL',
          'Only final games can be reopened',
        );
      }
      next.phase = 'reopened';
      break;
    default:
      assertNever(command);
  }

  next.sequence += 1;
  next.version += 1;

  return {
    event: {
      gameClockRemainingMs: next.gameClockRemainingMs,
      id: eventId,
      idempotencyKey: command.idempotencyKey,
      overtimeNumber: next.overtimeNumber,
      payload: eventPayload,
      periodNumber: next.currentPeriodNumber,
      reversesEventId,
      sequence: next.sequence,
      shotClockRemainingMs: next.shotClockRemainingMs,
      type: command.type,
    },
    state: next,
  };
}

export function materializeClocks(
  state: ScoringState,
  now: Date,
): ScoringState {
  const next = cloneState(state);

  if (next.gameClockRunning && next.gameClockStartedAt) {
    const elapsedMs = Math.max(
      0,
      now.getTime() - next.gameClockStartedAt.getTime(),
    );
    next.gameClockRemainingMs = Math.max(
      0,
      next.gameClockRemainingMs - elapsedMs,
    );
    next.gameClockStartedAt = next.gameClockRemainingMs > 0 ? now : null;

    if (next.gameClockRemainingMs === 0) {
      next.gameClockRunning = false;
      next.shotClockRunning = false;
      next.shotClockStartedAt = null;
    }
  }

  if (next.shotClockRunning && next.shotClockStartedAt) {
    const elapsedMs = Math.max(
      0,
      now.getTime() - next.shotClockStartedAt.getTime(),
    );
    next.shotClockRemainingMs = Math.max(
      0,
      next.shotClockRemainingMs - elapsedMs,
    );
    next.shotClockStartedAt =
      next.shotClockRemainingMs > 0 && next.shotClockRunning ? now : null;

    if (next.shotClockRemainingMs === 0) {
      next.shotClockRunning = false;
    }
  }

  return next;
}

function assertDurationRange(
  field: string,
  value: number,
  min: number,
  max: number,
) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ScoringActionError(
      'INVALID_DURATION',
      `${field} must be between ${min} and ${max} milliseconds`,
    );
  }
}

function assertFinalizable(state: ScoringState) {
  if (state.gameClockRunning || state.shotClockRunning) {
    throw new ScoringActionError(
      'CLOCKS_RUNNING',
      'Pause both clocks before finalizing',
    );
  }

  if (
    state.currentPeriodNumber < state.regulationPeriods ||
    state.gameClockRemainingMs > 0 ||
    state.phase !== 'period_break'
  ) {
    throw new ScoringActionError(
      'REGULATION_INCOMPLETE',
      'Regulation must be complete before finalization',
    );
  }

  if (state.homeScore === state.awayScore) {
    throw new ScoringActionError(
      'TIE_REQUIRES_OVERTIME',
      'Tied games must continue to overtime',
    );
  }
}

function assertNever(value: never): never {
  throw new ScoringActionError(
    'UNSUPPORTED_COMMAND',
    `Unsupported scoring command: ${JSON.stringify(value)}`,
  );
}

function assertNotFinal(state: ScoringState) {
  if (state.phase === 'final') {
    throw new ScoringActionError(
      'GAME_FINAL',
      'Final games must be reopened before scoring changes',
    );
  }
}

function assertPregame(state: ScoringState) {
  if (state.phase !== 'pregame') {
    throw new ScoringActionError(
      'GAME_ALREADY_STARTED',
      'Clock settings can only be changed before the game starts',
    );
  }
}

function assertReason(reason?: string) {
  if (!reason?.trim()) {
    throw new ScoringActionError(
      'REASON_REQUIRED',
      'This scoring action requires a reason',
    );
  }
}

function cloneState(state: ScoringState): ScoringState {
  return {
    ...state,
    gameClockStartedAt: state.gameClockStartedAt
      ? new Date(state.gameClockStartedAt)
      : null,
    latestReversibleEvent: state.latestReversibleEvent
      ? {
          ...state.latestReversibleEvent,
          payload: { ...state.latestReversibleEvent.payload },
        }
      : null,
    shotClockStartedAt: state.shotClockStartedAt
      ? new Date(state.shotClockStartedAt)
      : null,
  };
}

function commandPayload(command: ScoringCommand): Record<string, unknown> {
  if ('payload' in command && command.payload) {
    return { ...command.payload };
  }

  return {};
}

function currentPeriodDuration(state: ScoringState) {
  return state.overtimeNumber > 0
    ? state.overtimeDurationMs
    : state.periodDurationMs;
}

function resolveTeamSide(state: ScoringState, teamId: string): ScoringTeamSide {
  if (teamId === state.homeTeamId) {
    return 'home';
  }

  if (teamId === state.awayTeamId) {
    return 'away';
  }

  throw new ScoringActionError(
    'TEAM_NOT_IN_GAME',
    'Team does not belong to this scheduled game',
  );
}

function reverseLatestEvent(
  state: ScoringState,
  event: LatestReversibleScoringEvent,
) {
  if (event.type === 'score.record') {
    const teamId = event.payload.teamId;
    const points = event.payload.points;

    if (typeof teamId !== 'string' || typeof points !== 'number') {
      throw new ScoringActionError(
        'INVALID_REVERSAL_PAYLOAD',
        'Cannot reverse score event payload',
      );
    }

    const side = resolveTeamSide(state, teamId);
    if (side === 'home') {
      state.homeScore = Math.max(0, state.homeScore - points);
    } else {
      state.awayScore = Math.max(0, state.awayScore - points);
    }
    return;
  }

  const teamId = event.payload.teamId;
  if (typeof teamId !== 'string') {
    throw new ScoringActionError(
      'INVALID_REVERSAL_PAYLOAD',
      'Cannot reverse foul event payload',
    );
  }

  const side = resolveTeamSide(state, teamId);
  if (side === 'home') {
    state.homeTeamFouls = Math.max(0, state.homeTeamFouls - 1);
  } else {
    state.awayTeamFouls = Math.max(0, state.awayTeamFouls - 1);
  }
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
