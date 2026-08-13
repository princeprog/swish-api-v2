import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PaginationQueryDto,
  TrimmedOptionalString,
} from '../../../common/pagination/pagination.dto';
import type { ComplianceReviewQueueScope } from '../compliance-policy';

export class ComplianceReviewQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['needs_review', 'all', 'completed'])
  scope?: ComplianceReviewQueueScope;

  @IsOptional()
  @IsIn([
    'draft',
    'submitted',
    'under_review',
    'approved',
    'rejected',
    'waived',
    'reopened',
  ])
  status?: string;

  @TrimmedOptionalString()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
