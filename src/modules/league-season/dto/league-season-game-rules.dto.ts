import {
  IsBoolean,
  IsInt,
  Max,
  Min,
  Validate,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'shortResetWithinFullClock', async: false })
class ShortResetWithinFullClockConstraint
  implements ValidatorConstraintInterface
{
  validate(value: number, arguments_: ValidationArguments): boolean {
    const rules = arguments_.object as LeagueSeasonGameRulesDto;

    return (
      Number.isInteger(value) &&
      Number.isInteger(rules.shotClockFullMs) &&
      value <= rules.shotClockFullMs
    );
  }

  defaultMessage(): string {
    return 'The short reset cannot be longer than the full shot clock.';
  }
}

export class LeagueSeasonGameRulesDto {
  @IsInt()
  @Min(1)
  @Max(10)
  personalFoulLimit!: number;

  @IsInt()
  @Min(1)
  @Max(8)
  regulationPeriods!: number;

  @IsInt()
  @Min(60000)
  @Max(1800000)
  periodDurationMs!: number;

  @IsInt()
  @Min(60000)
  @Max(1800000)
  overtimeDurationMs!: number;

  @IsBoolean()
  shotClockEnabled!: boolean;

  @IsInt()
  @Min(1000)
  @Max(99000)
  shotClockFullMs!: number;

  @IsInt()
  @Min(1000)
  @Max(99000)
  @Validate(ShortResetWithinFullClockConstraint)
  shotClockShortMs!: number;

  @IsInt()
  @Min(1)
  @Max(20)
  teamFoulsBeforePenalty!: number;

  @IsInt()
  @Min(0)
  @Max(10)
  timeoutsFirstHalf!: number;

  @IsInt()
  @Min(0)
  @Max(10)
  timeoutsSecondHalf!: number;

  @IsInt()
  @Min(0)
  @Max(10)
  timeoutsPerOvertime!: number;
}
