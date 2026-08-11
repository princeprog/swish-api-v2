import { IsISO8601, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateComplianceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instructions?: string | null;

  @IsOptional()
  @IsISO8601()
  submissionDeadlineAt?: string | null;

  @IsOptional()
  @IsIn(['draft', 'archived'])
  status?: 'draft' | 'archived';
}
