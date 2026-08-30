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

const customRules = {
  overtimeDurationMs: 180000,
  periodDurationMs: 480000,
  regulationPeriods: 6,
  shotClockEnabled: false,
  shotClockFullMs: 30000,
  shotClockShortMs: 20000,
  teamFoulsBeforePenalty: 2,
  timeoutsFirstHalf: 1,
  timeoutsPerOvertime: 2,
  timeoutsSecondHalf: 4,
};

describe('scoring engine', () => {
  it('initializes a game from its season rule snapshot', () => {
    const state = createInitialScoringState({ ...game, gameRules: customRules });

    expect(state).toEqual(
      expect.objectContaining({
        gameClockRemainingMs: 480000,
        overtimeDurationMs: 180000,
        periodDurationMs: 480000,
        regulationPeriods: 6,
        shotClockEnabled: false,
        shotClockFullMs: 30000,
        shotClockRemainingMs: 30000,
        shotClockShortMs: 20000,
        teamFoulsBeforePenalty: 2,
        timeoutAllowancePerTeam: 1,
        timeoutsFirstHalf: 1,
        timeoutsPerOvertime: 2,
        timeoutsSecondHalf: 4,
      }),
    );
  });

  it('keeps the shot clock stopped and rejects its controls when disabled', () => {
    const started = applyScoringCommand(
      createInitialScoringState({ ...game, gameRules: customRules }),
      { idempotencyKey: 'start-no-shot-clock', type: 'game.start' },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;
    const paused = applyScoringCommand(
      started,
      { idempotencyKey: 'pause-no-shot-clock', type: 'clocks.pause' },
      new Date('2026-07-29T10:00:06.000Z'),
    ).state;

    expect(paused.gameClockRemainingMs).toBe(474000);
    expect(paused.shotClockRemainingMs).toBe(30000);
    expect(paused.shotClockRunning).toBe(false);
    expect(() =>
      applyScoringCommand(
        paused,
        {
          idempotencyKey: 'reset-disabled-shot-clock',
          payload: { resetTo: 'full' },
          type: 'shot_clock.reset',
        },
        new Date('2026-07-29T10:00:07.000Z'),
      ),
    ).toThrow('This season does not use a shot clock.');
  });

  it('directs legacy game configuration to season settings', () => {
    expect(() =>
      applyScoringCommand(
        createInitialScoringState(game),
        {
          idempotencyKey: 'legacy-game-configure',
          payload: { periodDurationMs: 480000 },
          type: 'game.configure',
        },
        new Date('2026-07-29T10:00:00.000Z'),
      ),
    ).toThrow('Game rules are managed in the season settings.');
  });

  it('uses the configured team foul penalty threshold', () => {
    let state = createInitialScoringState({ ...game, gameRules: customRules });

    for (const foulNumber of [1, 2]) {
      state = applyScoringCommand(
        state,
        {
          idempotencyKey: `custom-foul-${foulNumber}`,
          payload: { teamId: 'home-team' },
          type: 'team_foul.record',
        },
        new Date(`2026-07-29T10:00:0${foulNumber}.000Z`),
      ).state;
    }

    expect(state.homeInPenalty).toBe(true);
  });

  it('uses configurable timeout allowances and the custom season midpoint', () => {
    const firstHalf = createInitialScoringState({
      ...game,
      gameRules: customRules,
    });
    const midpointFirstHalf = applyScoringCommand(
      {
        ...firstHalf,
        currentPeriodNumber: 3,
        phase: 'paused',
      },
      {
        idempotencyKey: 'custom-midpoint-first-half-timeout',
        payload: { teamId: 'home-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    );
    const secondHalf = applyScoringCommand(
      {
        ...firstHalf,
        currentPeriodNumber: 4,
        phase: 'paused',
      },
      {
        idempotencyKey: 'custom-second-half-timeout',
        payload: { teamId: 'away-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:00:01.000Z'),
    ).state;
    const overtime = applyScoringCommand(
      {
        ...secondHalf,
        awayTimeoutsUsed: 0,
        overtimeNumber: 1,
      },
      {
        idempotencyKey: 'custom-overtime-timeout',
        payload: { teamId: 'away-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:00:02.000Z'),
    ).state;

    expect(firstHalf.timeoutAllowancePerTeam).toBe(1);
    expect(midpointFirstHalf.event.payload).toEqual({
      segment: 'first_half',
      teamId: 'home-team',
    });
    expect(midpointFirstHalf.state.timeoutSegment).toBe('first_half');
    expect(midpointFirstHalf.state.timeoutAllowancePerTeam).toBe(1);
    expect(secondHalf.timeoutSegment).toBe('second_half');
    expect(secondHalf.timeoutAllowancePerTeam).toBe(4);
    expect(secondHalf.awayTimeoutsRemaining).toBe(3);
    expect(overtime.timeoutAllowancePerTeam).toBe(2);
    expect(overtime.awayTimeoutsRemaining).toBe(1);
  });

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

  it('rejects starting the game after it has already left pregame', () => {
    const started = applyScoringCommand(
      createInitialScoringState(game),
      {
        idempotencyKey: 'start',
        type: 'game.start',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    expect(() =>
      applyScoringCommand(
        started,
        {
          idempotencyKey: 'duplicate-start',
          type: 'game.start',
        },
        new Date('2026-07-29T10:00:01.000Z'),
      ),
    ).toThrow('Game can only be started from pregame');
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
      {
        ...withFoul,
        gameClockRemainingMs: 0,
      },
      {
        idempotencyKey: 'period-end',
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

  it('attributes a personal foul while deriving the team foul total', () => {
    const result = applyScoringCommand(
      createInitialScoringState(game),
      {
        idempotencyKey: 'personal-foul-1',
        payload: {
          playerId: 'game-roster-player-1',
          teamId: 'home-team',
        },
        type: 'personal_foul.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    );

    expect(result.state.homeTeamFouls).toBe(1);
    expect(result.event).toMatchObject({
      payload: {
        playerId: 'game-roster-player-1',
        teamId: 'home-team',
      },
      type: 'personal_foul.record',
    });
    expect(result.state.latestReversibleEvent?.summary).toBe(
      'Home personal foul',
    );
  });

  it('blocks ending a period while time remains on the game clock', () => {
    expect(() =>
      applyScoringCommand(
        {
          ...createInitialScoringState(game),
          phase: 'paused',
          gameClockRemainingMs: 1000,
        },
        {
          idempotencyKey: 'early-period-end',
          payload: { reason: 'Scorekeeper pressed End period early' },
          type: 'period.end',
        },
        new Date('2026-07-29T10:01:00.000Z'),
      ),
    ).toThrow('The period can only be ended when the game clock reaches 0:00');
  });

  it('blocks starting the next period while the previous period still has time', () => {
    expect(() =>
      applyScoringCommand(
        {
          ...createInitialScoringState(game),
          phase: 'period_break',
          gameClockRemainingMs: 1000,
        },
        {
          idempotencyKey: 'early-next-period',
          type: 'period.start',
        },
        new Date('2026-07-29T10:01:00.000Z'),
      ),
    ).toThrow(
      'The next period can only start after the game clock reaches 0:00',
    );
  });

  it('starts the next period when the visible game clock shows 0:00', () => {
    const nextPeriod = applyScoringCommand(
      {
        ...createInitialScoringState(game),
        phase: 'paused',
        gameClockRemainingMs: 999,
        shotClockRemainingMs: 24000,
      },
      {
        idempotencyKey: 'visible-zero-next-period',
        type: 'period.start',
      },
      new Date('2026-07-29T10:01:00.000Z'),
    ).state;

    expect(nextPeriod.currentPeriodNumber).toBe(2);
    expect(nextPeriod.gameClockRemainingMs).toBe(600000);
    expect(nextPeriod.shotClockRemainingMs).toBe(24000);
  });

  it('blocks scoring actions when the period clock has reached zero', () => {
    const endedPeriod = {
      ...createInitialScoringState(game),
      phase: 'paused' as const,
      gameClockRemainingMs: 999,
    };

    for (const command of [
      {
        idempotencyKey: 'score-after-period',
        payload: { points: 2, teamId: 'home-team' },
        type: 'score.record' as const,
      },
      {
        idempotencyKey: 'foul-after-period',
        payload: { teamId: 'home-team' },
        type: 'team_foul.record' as const,
      },
      {
        idempotencyKey: 'timeout-after-period',
        payload: { teamId: 'home-team' },
        type: 'timeout.record' as const,
      },
    ]) {
      expect(() =>
        applyScoringCommand(
          endedPeriod,
          command,
          new Date('2026-07-29T10:01:00.000Z'),
        ),
      ).toThrow(
        'This period has ended. Start the next period before recording more actions.',
      );
    }
  });

  it('marks a team in the penalty on its fourth team foul', () => {
    let state = createInitialScoringState(game);

    for (const foulNumber of [1, 2, 3, 4]) {
      state = applyScoringCommand(
        state,
        {
          idempotencyKey: `home-foul-${foulNumber}`,
          payload: { teamId: 'home-team' },
          type: 'team_foul.record',
        },
        new Date(`2026-07-29T10:00:0${foulNumber}.000Z`),
      ).state;
    }

    expect(state.homeTeamFouls).toBe(4);
    expect(state.homeInPenalty).toBe(true);
    expect(state.awayInPenalty).toBe(false);
  });

  it('records a first-half timeout, pauses both clocks, and makes it immediately reversible', () => {
    const started = applyScoringCommand(
      createInitialScoringState(game),
      {
        idempotencyKey: 'start',
        type: 'game.start',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const withTimeout = applyScoringCommand(
      started,
      {
        idempotencyKey: 'home-timeout-1',
        payload: { teamId: 'home-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:00:05.000Z'),
    );

    expect(withTimeout.event.payload).toEqual({
      segment: 'first_half',
      teamId: 'home-team',
    });
    expect(withTimeout.state.homeTimeoutsUsed).toBe(1);
    expect(withTimeout.state.timeoutSegment).toBe('first_half');
    expect(withTimeout.state.timeoutAllowancePerTeam).toBe(2);
    expect(withTimeout.state.homeTimeoutsRemaining).toBe(1);
    expect(withTimeout.state.phase).toBe('paused');
    expect(withTimeout.state.gameClockRunning).toBe(false);
    expect(withTimeout.state.shotClockRunning).toBe(false);
    expect(withTimeout.state.latestReversibleEvent?.type).toBe(
      'timeout.record',
    );
  });

  it('applies FIBA timeout allowances by half and overtime without carryover', () => {
    let state = {
      ...createInitialScoringState(game),
      phase: 'paused' as const,
    };

    for (const index of [1, 2]) {
      state = applyScoringCommand(
        state,
        {
          idempotencyKey: `first-half-timeout-${index}`,
          payload: { teamId: 'away-team' },
          type: 'timeout.record',
        },
        new Date(`2026-07-29T10:00:0${index}.000Z`),
      ).state;
    }

    expect(state.awayTimeoutsRemaining).toBe(0);
    expect(() =>
      applyScoringCommand(
        state,
        {
          idempotencyKey: 'first-half-timeout-3',
          payload: { teamId: 'away-team' },
          type: 'timeout.record',
        },
        new Date('2026-07-29T10:00:03.000Z'),
      ),
    ).toThrow('No timeouts remain for this team in the current segment');

    const quarterOneBreak = applyScoringCommand(
      {
        ...state,
        gameClockRemainingMs: 0,
      },
      {
        idempotencyKey: 'end-q1',
        type: 'period.end',
      },
      new Date('2026-07-29T10:01:00.000Z'),
    ).state;
    const quarterTwo = applyScoringCommand(
      quarterOneBreak,
      {
        idempotencyKey: 'start-q2',
        type: 'period.start',
      },
      new Date('2026-07-29T10:01:01.000Z'),
    ).state;
    const secondHalf = applyScoringCommand(
      {
        ...quarterTwo,
        gameClockRemainingMs: 0,
      },
      {
        idempotencyKey: 'end-q2',
        type: 'period.end',
      },
      new Date('2026-07-29T10:02:00.000Z'),
    ).state;
    const secondHalfStarted = applyScoringCommand(
      secondHalf,
      {
        idempotencyKey: 'start-q3',
        type: 'period.start',
      },
      new Date('2026-07-29T10:02:01.000Z'),
    ).state;

    expect(secondHalfStarted.timeoutSegment).toBe('second_half');
    expect(secondHalfStarted.awayTimeoutsUsed).toBe(0);
    expect(secondHalfStarted.awayTimeoutsRemaining).toBe(3);

    const overtime = {
      ...secondHalfStarted,
      overtimeNumber: 1,
      homeTimeoutsUsed: 0,
      awayTimeoutsUsed: 0,
    };
    const overtimeState = applyScoringCommand(
      overtime,
      {
        idempotencyKey: 'overtime-timeout',
        payload: { teamId: 'away-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:03:00.000Z'),
    ).state;

    expect(overtimeState.timeoutSegment).toBe('overtime');
    expect(overtimeState.timeoutAllowancePerTeam).toBe(1);
    expect(overtimeState.awayTimeoutsRemaining).toBe(0);
  });

  it('reverses a timeout without restarting either clock', () => {
    const timedOut = applyScoringCommand(
      {
        ...createInitialScoringState(game),
        phase: 'paused' as const,
      },
      {
        idempotencyKey: 'home-timeout',
        payload: { teamId: 'home-team' },
        type: 'timeout.record',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const reversed = applyScoringCommand(
      timedOut,
      {
        idempotencyKey: 'undo-timeout',
        payload: { eventId: timedOut.latestReversibleEvent?.id },
        type: 'event.reverse',
      },
      new Date('2026-07-29T10:00:01.000Z'),
    ).state;

    expect(reversed.homeTimeoutsUsed).toBe(0);
    expect(reversed.homeTimeoutsRemaining).toBe(2);
    expect(reversed.phase).toBe('paused');
    expect(reversed.gameClockRunning).toBe(false);
    expect(reversed.shotClockRunning).toBe(false);
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
        type: 'game.start',
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

  it('starts the next period directly when the game clock has already expired', () => {
    const started = applyScoringCommand(
      {
        ...createInitialScoringState(game),
        gameClockRemainingMs: 1000,
      },
      {
        idempotencyKey: 'start-expiring-period',
        type: 'game.start',
      },
      new Date('2026-07-29T10:00:00.000Z'),
    ).state;

    const nextPeriod = applyScoringCommand(
      started,
      {
        idempotencyKey: 'next-period-after-expiry',
        type: 'period.start',
      },
      new Date('2026-07-29T10:00:01.500Z'),
    ).state;

    expect(nextPeriod.currentPeriodNumber).toBe(2);
    expect(nextPeriod.phase).toBe('paused');
    expect(nextPeriod.gameClockRemainingMs).toBe(600000);
    expect(nextPeriod.shotClockRemainingMs).toBe(24000);
    expect(nextPeriod.gameClockRunning).toBe(false);
    expect(nextPeriod.shotClockRunning).toBe(false);
  });
});
