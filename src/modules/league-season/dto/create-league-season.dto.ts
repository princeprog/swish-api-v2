import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeagueSeasonGameRulesDto } from './league-season-game-rules.dto';
import { LeagueSeasonCompetitionDefaultsDto } from './league-season-competition-defaults.dto';

export class CreateLeagueSeasonDto {
  @IsUUID()
  organizationId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LeagueSeasonGameRulesDto)
  gameRules!: LeagueSeasonGameRulesDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => LeagueSeasonCompetitionDefaultsDto)
  competitionDefaults!: LeagueSeasonCompetitionDefaultsDto;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  scheduleSlotDurationMinutes?: number;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Length(2, 160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsBoolean()
  publicEnabled?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(['draft', 'active', 'inactive'])
  status?: string;
}
