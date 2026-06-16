import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsString()
  @Length(2, 160)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;
}
