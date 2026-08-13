import { IsOptional } from 'class-validator';

export class SubmitComplianceRequirementDto {
  @IsOptional()
  response?: unknown;
}
