import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LeagueSeasonGameRulesDto } from './league-season-game-rules.dto';

export class CreateLeagueSeasonDto {
  @IsUUID()
  organizationId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => LeagueSeasonGameRulesDto)
  gameRules!: LeagueSeasonGameRulesDto;

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
