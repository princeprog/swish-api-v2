import {
  applyScoringCommand,
  createInitialScoringState,
  ScoringActionError,
} from './scoring-engine';

const game = {
  awayTeamId: 'away-team',
  gameId: 'game-1',
  homeTeamId: 'home-team',
};

describe('scoring engine', () => {
  it('starts a game and runs both clocks from authoritative anchors', () => {
    const state = createInitialScoringState(game);
    const started = applyScoringCommand(
      state,
      {
        idempotencyKey: 'start',
        type: 'game.start',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const afterSixSeconds = applyScoringCommand(
      started,
      {
        idempotencyKey: 'pause',
        type: 'clocks.pause',
      },
      new Date('2026-07-29T10:00:06.000Z'),
    ).state;

    expect(afterSixSeconds.phase).toBe('paused');
    expect(afterSixSeconds.gameClockRemainingMs).toBe(594000);
    expect(afterSixSeconds.shotClockRemainingMs).toBe(18000);
    expect(afterSixSeconds.gameClockRunning).toBe(false);
    expect(afterSixSeconds.shotClockRunning).toBe(false);
  });

  it('records only one, two, or three points for the scheduled teams', () => {
    const state = createInitialScoringState(game);
    const twoPoints = applyScoringCommand(
      state,
      {
        idempotencyKey: 'score-1',
        payload: { points: 2, teamId: 'home-team' },
        type: 'score.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    );

    expect(twoPoints.state.homeScore).toBe(2);
    expect(twoPoints.state.latestReversibleEvent?.summary).toBe('Home +2');

    expect(() =>
      applyScoringCommand(
        twoPoints.state,
        {
          idempotencyKey: 'score-2',
          payload: { points: 4, teamId: 'home-team' },
          type: 'score.record',
        },
        new Date('2026-07-29T10:00:01.000Z'),
      ),
    ).toThrow(ScoringActionError);
  });

  it('records team fouls for the current period and resets them on the next period', () => {
    const state = createInitialScoringState(game);
    const withFoul = applyScoringCommand(
      state,
      {
        idempotencyKey: 'foul-1',
        payload: { teamId: 'away-team' },
        type: 'team_foul.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const periodBreak = applyScoringCommand(
      withFoul,
      {
        idempotencyKey: 'period-end',
        payload: { reason: 'Manual period advance in test' },
        type: 'period.end',
      },
      new Date('2026-07-29T10:01:00.000Z'),
    ).state;
    const nextPeriod = applyScoringCommand(
      periodBreak,
      {
        idempotencyKey: 'period-start',
        type: 'period.start',
      },
      new Date('2026-07-29T10:01:10.000Z'),
    ).state;

    expect(withFoul.awayTeamFouls).toBe(1);
    expect(nextPeriod.currentPeriodNumber).toBe(2);
    expect(nextPeriod.awayTeamFouls).toBe(0);
    expect(nextPeriod.gameClockRemainingMs).toBe(600000);
  });

  it('reverses the latest score or foul without mutating the original event', () => {
    const state = createInitialScoringState(game);
    const scored = applyScoringCommand(
      state,
      {
        idempotencyKey: 'score-1',
        payload: { points: 3, teamId: 'away-team' },
        type: 'score.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;
    const reversed = applyScoringCommand(
      scored,
      {
        idempotencyKey: 'undo-1',
        payload: { eventId: scored.latestReversibleEvent?.id },
        type: 'event.reverse',
      },
      new Date('2026-07-29T10:00:01.000Z'),
    );

    expect(reversed.state.awayScore).toBe(0);
    expect(reversed.event.reversesEventId).toBe(
      scored.latestReversibleEvent?.id,
    );
    expect(reversed.state.latestReversibleEvent).toBeNull();
  });

  it('requires completed regulation, paused clocks, and a non-tied score before finalization', () => {
    const regulationComplete = {
      ...createInitialScoringState(game),
      awayScore: 58,
      currentPeriodNumber: 4,
      gameClockRemainingMs: 0,
      homeScore: 62,
      phase: 'period_break' as const,
      shotClockRemainingMs: 0,
    };

    const finalized = applyScoringCommand(
      regulationComplete,
      {
        idempotencyKey: 'final',
        type: 'game.finalize',
      },
      new Date('2026-07-29T11:30:00.000Z'),
    ).state;

    expect(finalized.phase).toBe('final');

    expect(() =>
      applyScoringCommand(
        { ...regulationComplete, awayScore: 62 },
        {
          idempotencyKey: 'tie-final',
          type: 'game.finalize',
        },
        new Date('2026-07-29T11:30:01.000Z'),
      ),
    ).toThrow('Tied games must continue to overtime');
  });

  it('validates pregame clock settings and blocks a short reset longer than full reset', () => {
    const state = createInitialScoringState(game);

    const configured = applyScoringCommand(
      state,
      {
        idempotencyKey: 'configure',
        payload: {
          overtimeDurationMs: 240000,
          periodDurationMs: 480000,
          shotClockFullMs: 30000,
          shotClockShortMs: 15000,
        },
        type: 'game.configure',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    expect(configured.gameClockRemainingMs).toBe(480000);
    expect(configured.shotClockFullMs).toBe(30000);

    expect(() =>
      applyScoringCommand(
        state,
        {
          idempotencyKey: 'bad-configure',
          payload: {
            shotClockFullMs: 12000,
            shotClockShortMs: 14000,
          },
          type: 'game.configure',
        },
        new Date('2026-07-29T10:00:01.000Z'),
      ),
    ).toThrow('Short reset cannot exceed the full shot clock');
  });

  it('stops only the shot clock when the shot clock expires first', () => {
    const state = createInitialScoringState(game);
    const started = applyScoringCommand(
      {
        ...state,
        gameClockRemainingMs: 120000,
        shotClockRemainingMs: 5000,
      },
      {
        idempotencyKey: 'start',
        type: 'clocks.start',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const materialized = applyScoringCommand(
      started,
      {
        idempotencyKey: 'score-after-expired-shot',
        payload: { points: 1, teamId: 'home-team' },
        type: 'score.record',
      },
      new Date('2026-07-29T10:00:06.000Z'),
    ).state;

    expect(materialized.shotClockRemainingMs).toBe(0);
    expect(materialized.shotClockRunning).toBe(false);
    expect(materialized.gameClockRemainingMs).toBe(114000);
    expect(materialized.gameClockRunning).toBe(true);
  });

  it('advances tied regulation to overtime before finalization can succeed', () => {
    const tiedAtEndOfRegulation = {
      ...createInitialScoringState(game),
      awayScore: 62,
      currentPeriodNumber: 4,
      gameClockRemainingMs: 0,
      homeScore: 62,
      phase: 'period_break' as const,
      shotClockRemainingMs: 0,
    };

    const overtime = applyScoringCommand(
      tiedAtEndOfRegulation,
      {
        idempotencyKey: 'start-ot',
        type: 'period.start',
      },
      new Date('2026-07-29T11:30:00.000Z'),
    ).state;

    expect(overtime.overtimeNumber).toBe(1);
    expect(overtime.currentPeriodNumber).toBe(4);
    expect(overtime.gameClockRemainingMs).toBe(300000);
    expect(overtime.homeTeamFouls).toBe(0);
  });
});
