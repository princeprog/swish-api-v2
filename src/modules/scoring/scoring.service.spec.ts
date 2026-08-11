import { ScoringService } from './scoring.service';

const game = {
  away_score: null,
  away_team_id: 'away-team',
  away_team_name: 'Away',
  division_name: 'Open',
  division_id: 'division-1',
  home_score: null,
  home_team_id: 'home-team',
  home_team_name: 'Home',
  id: 'game-1',
  league_season_id: 'season-1',
  organization_id: 'org-1',
  starts_at: new Date('2026-08-04T10:00:00.000Z'),
  status: 'scheduled',
  venue_name: 'Main Court',
};

const storedState = {
  away_score: 0,
  away_team_fouls: 0,
  away_timeouts_used: 0,
  current_period_number: 1,
  game_clock_remaining_ms: 600000,
  game_clock_running: false,
  game_clock_started_at: null,
  home_score: 0,
  home_team_fouls: 0,
  home_timeouts_used: 0,
  latest_reversible_event_id: null,
  overtime_duration_ms: 300000,
  overtime_number: 0,
  period_duration_ms: 600000,
  phase: 'pregame',
  regulation_periods: 4,
  shot_clock_enabled: true,
  shot_clock_full_ms: 24000,
  shot_clock_remaining_ms: 24000,
  shot_clock_running: false,
  shot_clock_short_ms: 14000,
  shot_clock_started_at: null,
  team_fouls_before_penalty: 4,
  timeouts_first_half: 2,
  timeouts_per_overtime: 1,
  timeouts_second_half: 3,
  version: 0,
};

const currentSeasonRules = {
  created_at: new Date('2026-08-04T00:00:00.000Z'),
  league_season_id: 'season-1',
  overtime_duration_ms: 180000,
  period_duration_ms: 480000,
  regulation_periods: 6,
  shot_clock_enabled: false,
  shot_clock_full_ms: 30000,
  shot_clock_short_ms: 20000,
  team_fouls_before_penalty: 2,
  timeouts_first_half: 1,
  timeouts_per_overtime: 2,
  timeouts_second_half: 4,
  updated_at: new Date('2026-08-04T00:00:00.000Z'),
};

function chainWithResult(result: unknown) {
  return {
    executeTakeFirst: jest.fn().mockResolvedValue(result),
    forShare: jest.fn().mockReturnThis(),
    forUpdate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };
}

describe('ScoringService season rule snapshots', () => {
  it('refreshes an unstarted game from the latest season rules', async () => {
    const stateQuery = chainWithResult(storedState);
    const rulesQuery = chainWithResult(currentSeasonRules);
    const db = {
      selectFrom: jest.fn((table: string) =>
        table === 'scoring.game_states' ? stateQuery : rulesQuery,
      ),
    };
    const service = new ScoringService(db as never);

    const state = await (service as any).ensureScoringState(game);

    expect(state).toEqual(
      expect.objectContaining({
        gameClockRemainingMs: 480000,
        periodDurationMs: 480000,
        regulationPeriods: 6,
        shotClockEnabled: false,
        teamFoulsBeforePenalty: 2,
        timeoutsFirstHalf: 1,
      }),
    );
    expect(rulesQuery.executeTakeFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps the stored snapshot after a game leaves pregame', async () => {
    const stateQuery = chainWithResult({ ...storedState, phase: 'live' });
    const rulesQuery = chainWithResult(currentSeasonRules);
    const db = {
      selectFrom: jest.fn((table: string) =>
        table === 'scoring.game_states' ? stateQuery : rulesQuery,
      ),
    };
    const service = new ScoringService(db as never);

    const state = await (service as any).ensureScoringState({
      ...game,
      status: 'live',
    });

    expect(state.periodDurationMs).toBe(600000);
    expect(state.shotClockEnabled).toBe(true);
    expect(rulesQuery.executeTakeFirst).not.toHaveBeenCalled();
  });
});

describe('ScoringService compliance gate', () => {
  it('returns a clear action message when a scheduled game has uncleared teams', async () => {
    const complianceService = {
      checkGameStartClearance: jest.fn().mockResolvedValue({
        allowed: false,
        blockedTeams: [{ name: 'Away', status: 'pending' }],
      }),
    };
    const service = new ScoringService(
      {} as never,
      undefined,
      complianceService as never,
    );
    jest
      .spyOn(service as never, 'findGameForScoring' as never)
      .mockResolvedValue(game as never);
    jest
      .spyOn(service as never, 'assertControlSession' as never)
      .mockResolvedValue({} as never);

    await expect(
      service.executeCommand('org-1', 'game-1', {} as never, {
        command: { idempotencyKey: 'start-1', type: 'game.start' },
        expectedVersion: 0,
        occurredAt: new Date(),
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'TEAM_COMPLIANCE_REQUIRED',
      },
    });
  });
});
