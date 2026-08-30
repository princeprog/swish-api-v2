import { IsDateString, IsUUID, ValidateIf } from 'class-validator';

export class ScheduleMatchupDto {
  @IsDateString()
  startsAt!: string;

  @IsUUID()
  venueId!: string;

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  scorekeeperMemberId?: string | null;
}
