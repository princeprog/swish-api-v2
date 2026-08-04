import { LeagueSeasonService } from './league-season.service';

const season = {
  created_at: new Date('2026-08-04T00:00:00.000Z'),
  id: 'season-1',
  name: '2026 Summer League',
  organization_id: 'org-1',
  public_enabled: false,
  slug: '2026-summer-league',
  status: 'draft',
  updated_at: new Date('2026-08-04T00:00:00.000Z'),
};

const rules = {
  created_at: new Date('2026-08-04T00:00:00.000Z'),
  league_season_id: 'season-1',
  overtime_duration_ms: 300000,
  period_duration_ms: 600000,
  regulation_periods: 4,
  shot_clock_enabled: true,
  shot_clock_full_ms: 24000,
  shot_clock_short_ms: 14000,
  team_fouls_before_penalty: 4,
  timeouts_first_half: 2,
  timeouts_per_overtime: 1,
  timeouts_second_half: 3,
  updated_at: new Date('2026-08-04T00:00:00.000Z'),
};

const input = {
  gameRules: {
    overtimeDurationMs: 300000,
    periodDurationMs: 600000,
    regulationPeriods: 4,
    shotClockEnabled: true,
    shotClockFullMs: 24000,
    shotClockShortMs: 14000,
    teamFoulsBeforePenalty: 4,
    timeoutsFirstHalf: 2,
    timeoutsPerOvertime: 1,
    timeoutsSecondHalf: 3,
  },
  name: '2026 Summer League',
  organizationId: 'org-1',
  slug: '2026-summer-league',
};

function createInsertChain(result: Record<string, unknown>) {
  return {
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    returningAll: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
  };
}

describe('LeagueSeasonService game rules persistence', () => {
  it('creates the season and its rules in one transaction', async () => {
    const seasonInsert = createInsertChain(season);
    const rulesInsert = createInsertChain(rules);
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn((table: string) =>
          table === 'admin.league_seasons' ? seasonInsert : rulesInsert,
        ),
      }),
    );
    const lookup = {
      executeTakeFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValueOnce(undefined),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(lookup),
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new LeagueSeasonService(db as never);

    await expect(service.create('org-1', input)).resolves.toEqual({
      ...season,
      game_rules: {
        overtime_duration_ms: 300000,
        period_duration_ms: 600000,
        regulation_periods: 4,
        shot_clock_enabled: true,
        shot_clock_full_ms: 24000,
        shot_clock_short_ms: 14000,
        team_fouls_before_penalty: 4,
        timeouts_first_half: 2,
        timeouts_per_overtime: 1,
        timeouts_second_half: 3,
      },
    });
    expect(transactionExecute).toHaveBeenCalledTimes(1);
    expect(rulesInsert.values).toHaveBeenCalledWith({
      league_season_id: 'season-1',
      overtime_duration_ms: 300000,
      period_duration_ms: 600000,
      regulation_periods: 4,
      shot_clock_enabled: true,
      shot_clock_full_ms: 24000,
      shot_clock_short_ms: 14000,
      team_fouls_before_penalty: 4,
      timeouts_first_half: 2,
      timeouts_per_overtime: 1,
      timeouts_second_half: 3,
    });
  });

  it('does not create rules when the season insert fails', async () => {
    const seasonInsert = createInsertChain(season);
    seasonInsert.executeTakeFirstOrThrow.mockRejectedValueOnce(
      new Error('season insert failed'),
    );
    const rulesInsert = createInsertChain(rules);
    const lookup = {
      executeTakeFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: 'org-1' })
        .mockResolvedValueOnce(undefined),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(lookup),
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn(async (callback) =>
          callback({
            insertInto: jest.fn((table: string) =>
              table === 'admin.league_seasons' ? seasonInsert : rulesInsert,
            ),
          }),
        ),
      }),
    };
    const service = new LeagueSeasonService(db as never);

    await expect(service.create('org-1', input)).rejects.toThrow(
      'season insert failed',
    );
    expect(rulesInsert.values).not.toHaveBeenCalled();
  });
});
