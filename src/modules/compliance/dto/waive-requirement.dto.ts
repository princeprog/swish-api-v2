import { IsDateString, IsOptional } from 'class-validator';
import { ReviewReasonDto } from './review-reason.dto';

export class WaiveRequirementDto extends ReviewReasonDto {
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
