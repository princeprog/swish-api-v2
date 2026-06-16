import { IsIn, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class CreatePlayerDto {
  @IsUUID()
  teamId!: string;

  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Length(1, 20)
  @Matches(/^[A-Za-z0-9-]+$/)
  jerseyNumber!: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;
}
