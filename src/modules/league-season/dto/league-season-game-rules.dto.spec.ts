import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeagueSeasonDto } from './create-league-season.dto';
import { UpdateLeagueSeasonDto } from './update-league-season.dto';

const validRules = {
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
};

function createPayload(gameRules: Record<string, unknown> | undefined) {
  return {
    gameRules,
    name: '2026 Summer League',
    organizationId: 'c0a80121-0000-4000-8000-000000000001',
    slug: '2026-summer-league',
  };
}

describe('league season game rules DTO', () => {
  it('accepts the approved FIBA-style rule values', async () => {
    const dto = plainToInstance(
      CreateLeagueSeasonDto,
      createPayload(validRules),
    );

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('requires a complete rules object when creating a season', async () => {
    const missingRules = plainToInstance(
      CreateLeagueSeasonDto,
      createPayload(undefined),
    );
    const incompleteRules = plainToInstance(
      CreateLeagueSeasonDto,
      createPayload({ regulationPeriods: 4 }),
    );

    expect(await validate(missingRules)).not.toHaveLength(0);
    expect(await validate(incompleteRules)).not.toHaveLength(0);
  });

  it('rejects values outside the supported season ranges', async () => {
    const dto = plainToInstance(
      CreateLeagueSeasonDto,
      createPayload({
        ...validRules,
        periodDurationMs: 59000,
        regulationPeriods: 9,
        teamFoulsBeforePenalty: 21,
        timeoutsFirstHalf: 11,
      }),
    );

    const errors = await validate(dto);
    const ruleErrors = errors.find((error) => error.property === 'gameRules');

    expect(ruleErrors?.children?.map((error) => error.property)).toEqual(
      expect.arrayContaining([
        'periodDurationMs',
        'regulationPeriods',
        'teamFoulsBeforePenalty',
        'timeoutsFirstHalf',
      ]),
    );
  });

  it('uses a clear message when the short reset exceeds the full clock', async () => {
    const dto = plainToInstance(
      CreateLeagueSeasonDto,
      createPayload({
        ...validRules,
        shotClockFullMs: 14000,
        shotClockShortMs: 24000,
      }),
    );

    const errors = await validate(dto);
    const resetError = errors
      .find((error) => error.property === 'gameRules')
      ?.children?.find((error) => error.property === 'shotClockShortMs');

    expect(Object.values(resetError?.constraints ?? {})).toContain(
      'The short reset cannot be longer than the full shot clock.',
    );
  });

  it('allows updates without rules but validates a supplied rules object fully', async () => {
    const detailsOnly = plainToInstance(UpdateLeagueSeasonDto, {
      name: 'Renamed season',
    });
    const partialRules = plainToInstance(UpdateLeagueSeasonDto, {
      gameRules: { regulationPeriods: 4 },
    });

    await expect(validate(detailsOnly)).resolves.toHaveLength(0);
    expect(await validate(partialRules)).not.toHaveLength(0);
  });
});
