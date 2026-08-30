import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidateNested,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export const QUALIFYING_FORMATS = [
  'none',
  'single_round_robin',
  'double_round_robin',
] as const;

export const PLAYOFF_FORMATS = [
  'none',
  'single_elimination',
  'double_elimination',
] as const;

export const TIEBREAKER_RULES = [
  'win_percentage',
  'head_to_head',
  'point_differential',
  'points_for',
  'manual_decision',
] as const;

export type QualifyingFormat = (typeof QUALIFYING_FORMATS)[number];
export type PlayoffFormat = (typeof PLAYOFF_FORMATS)[number];
export type TiebreakerRule = (typeof TIEBREAKER_RULES)[number];

@ValidatorConstraint({ name: 'rankingStartsWithWinPercentage', async: false })
class RankingStartsWithWinPercentageConstraint
  implements ValidatorConstraintInterface
{
  validate(value: TiebreakerRule[]): boolean {
    return Array.isArray(value) && value[0] === 'win_percentage';
  }

  defaultMessage(): string {
    return 'Ranking must start with win percentage.';
  }
}

export class CrossoverMatchupDto {
  @IsString()
  @Matches(/^[A-Z]+[1-9]\d*$/)
  homeSeed!: string;

  @IsString()
  @Matches(/^[A-Z]+[1-9]\d*$/)
  awaySeed!: string;
}

export class LeagueSeasonCompetitionDefaultsDto {
  @IsIn(QUALIFYING_FORMATS)
  qualifyingFormat!: QualifyingFormat;

  @IsIn(PLAYOFF_FORMATS)
  playoffFormat!: PlayoffFormat;

  @IsInt()
  @Min(1)
  @Max(16)
  poolCount!: number;

  @IsInt()
  @Min(1)
  @Max(64)
  qualifiersPerPool!: number;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsIn(TIEBREAKER_RULES, { each: true })
  @Validate(RankingStartsWithWinPercentageConstraint)
  tiebreakers!: TiebreakerRule[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrossoverMatchupDto)
  crossoverTemplate!: CrossoverMatchupDto[];
}
