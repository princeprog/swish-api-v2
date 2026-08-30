import { DivisionService } from './division.service';

const seasonDefaults = {
  default_crossover_template: [
    { awaySeed: 'B2', homeSeed: 'A1' },
    { awaySeed: 'A2', homeSeed: 'B1' },
  ],
  default_playoff_format: 'single_elimination',
  default_pool_count: 2,
  default_qualifiers_per_pool: 2,
  default_qualifying_format: 'single_round_robin',
  default_tiebreakers: ['win_percentage', 'manual_decision'],
  id: 'season-1',
};

function insertChain(result?: Record<string, unknown>) {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue(result),
    onConflict: jest.fn().mockReturnThis(),
    returningAll: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
  };
}

describe('DivisionService competition defaults', () => {
  it('creates an editable format and named pools from the season defaults', async () => {
    const division = {
      id: 'division-1',
      league_season_id: 'season-1',
      name: 'Open',
      slug: 'open',
      status: 'active',
    };
    const format = { id: 'format-1' };
    const divisionInsert = insertChain(division);
    const rosterSettingsInsert = insertChain();
    const formatInsert = insertChain(format);
    const poolsInsert = insertChain();
    const transactionExecute = jest.fn(async (callback) =>
      callback({
        insertInto: jest.fn((table: string) => {
          if (table === 'admin.divisions') return divisionInsert;
          if (table === 'admin.division_roster_settings') {
            return rosterSettingsInsert;
          }
          if (table === 'competition.division_formats') return formatInsert;
          return poolsInsert;
        }),
      }),
    );
    const seasonLookup = {
      executeTakeFirst: jest.fn().mockResolvedValue(seasonDefaults),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const slugLookup = {
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(seasonLookup)
        .mockReturnValueOnce(slugLookup),
      transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
    };
    const service = new DivisionService(db as never);

    await expect(
      service.create('org-1', {
        leagueSeasonId: 'season-1',
        name: 'Open',
        slug: 'open',
      }),
    ).resolves.toEqual(division);

    expect(formatInsert.values).toHaveBeenCalledWith({
      crossover_template: JSON.stringify(
        seasonDefaults.default_crossover_template,
      ),
      division_id: 'division-1',
      playoff_format: 'single_elimination',
      pool_count: 2,
      qualifiers_per_pool: 2,
      qualifying_format: 'single_round_robin',
      tiebreakers: JSON.stringify(seasonDefaults.default_tiebreakers),
    });
    expect(poolsInsert.values).toHaveBeenCalledWith([
      {
        code: 'A',
        division_format_id: 'format-1',
        name: 'Pool A',
        sort_order: 1,
      },
      {
        code: 'B',
        division_format_id: 'format-1',
        name: 'Pool B',
        sort_order: 2,
      },
    ]);
    expect(transactionExecute).toHaveBeenCalledTimes(1);
  });
});
