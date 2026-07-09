import { IsOptional, IsUUID } from 'class-validator';

export class StandingsQueryDto {
  @IsUUID()
  leagueSeasonId!: string;

  @IsOptional()
  @IsUUID()
  divisionId?: string;
}
