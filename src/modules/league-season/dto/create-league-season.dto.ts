import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export class CreateLeagueSeasonDto {
  @IsUUID()
  organizationId!: string;

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
