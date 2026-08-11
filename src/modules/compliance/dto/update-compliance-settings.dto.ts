import { IsIn, IsOptional } from 'class-validator';

export class UpdateComplianceSettingsDto {
  @IsOptional()
  @IsIn(['draft', 'archived'])
  status?: 'draft' | 'archived';
}
