import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { COMPLIANCE_RESPONSE_TYPES } from '../compliance-policy';

export class CreateRequirementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  instructions?: string;

  @IsIn(COMPLIANCE_RESPONSE_TYPES)
  responseType!: (typeof COMPLIANCE_RESPONSE_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  maxFileCount?: number;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  sortOrder!: number;
}
