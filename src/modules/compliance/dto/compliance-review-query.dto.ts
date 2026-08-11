import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

export class ComplianceReviewQueryDto extends PaginationQueryDto {
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
}
