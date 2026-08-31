import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLeagueSeasonDto } from './create-league-season.dto';

const gameRules = {
  overtimeDurationMs: 300000,
  periodDurationMs: 600000,
  personalFoulLimit: 5,
  regulationPeriods: 4,
  shotClockEnabled: true,
  shotClockFullMs: 24000,
  shotClockShortMs: 14000,
  teamFoulsBeforePenalty: 4,
  timeoutsFirstHalf: 2,
  timeoutsPerOvertime: 1,
  timeoutsSecondHalf: 3,
};

function createPayload(competitionDefaults: unknown) {
  return plainToInstance(CreateLeagueSeasonDto, {
    competitionDefaults,
    gameRules,
    name: '2026 Summer League',
    organizationId: 'c0a80121-0000-4000-8000-000000000001',
    scheduleSlotDurationMinutes: 90,
    slug: '2026-summer-league',
  });
}

describe('league season competition defaults DTO', () => {
  it('accepts pool play with crossover semifinals and ordered tiebreakers', async () => {
    const dto = createPayload({
      crossoverTemplate: [
        { awaySeed: 'B2', homeSeed: 'A1' },
        { awaySeed: 'A2', homeSeed: 'B1' },
      ],
      playoffFormat: 'single_elimination',
      poolCount: 2,
      qualifiersPerPool: 2,
      qualifyingFormat: 'single_round_robin',
      tiebreakers: [
        'win_percentage',
        'head_to_head',
        'point_differential',
        'points_for',
        'manual_decision',
      ],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported formats, duplicate tiebreakers, and invalid seeds', async () => {
    const dto = createPayload({
      crossoverTemplate: [{ awaySeed: 'Team B', homeSeed: 'A0' }],
      playoffFormat: 'triple_elimination',
      poolCount: 2,
      qualifiersPerPool: 2,
      qualifyingFormat: 'swiss',
      tiebreakers: ['win_percentage', 'win_percentage'],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('requires the documented ranking order to start with win percentage', async () => {
    const dto = createPayload({
      crossoverTemplate: [],
      playoffFormat: 'none',
      poolCount: 1,
      qualifiersPerPool: 0,
      qualifyingFormat: 'none',
      tiebreakers: ['points_for', 'manual_decision'],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('requires the manual decision to be the final tiebreaker', async () => {
    const dto = createPayload({
      crossoverTemplate: [],
      playoffFormat: 'none',
      poolCount: 1,
      qualifiersPerPool: 1,
      qualifyingFormat: 'none',
      tiebreakers: ['win_percentage', 'manual_decision', 'points_for'],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects scheduling slots outside 15 minutes to one day', async () => {
    const dto = createPayload({
      crossoverTemplate: [],
      playoffFormat: 'none',
      poolCount: 1,
      qualifiersPerPool: 0,
      qualifyingFormat: 'none',
      tiebreakers: ['win_percentage', 'manual_decision'],
    });
    dto.scheduleSlotDurationMinutes = 10;

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
