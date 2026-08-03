import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class UpdateRosterSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  minActivePlayers?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  maxActivePlayers?: number | null;

  @IsOptional()
  @IsISO8601()
  submissionDeadlineAt?: string | null;
}
