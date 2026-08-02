import {
  IsDateString,
  IsIn,
  IsInt,
  Min,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';

export class CreateScheduleDto {
  @IsUUID()
  leagueSeasonId!: string;

  @IsUUID()
  divisionId!: string;

  @IsUUID()
  venueId!: string;

  @IsUUID()
  homeTeamId!: string;

  @IsUUID()
  awayTeamId!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  homeScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  awayScore?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    'draft',
    'scheduled',
    'live',
    'final',
    'reopened',
    'postponed',
    'cancelled',
  ])
  status?: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  scorekeeperMemberId?: string | null;
}
