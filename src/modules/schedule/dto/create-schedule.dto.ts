import {
  IsDateString,
  IsIn,
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
  @IsString()
  @IsIn(['draft', 'scheduled'])
  status?: 'draft' | 'scheduled';

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  scorekeeperMemberId?: string | null;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  statisticianMemberId?: string | null;
}
