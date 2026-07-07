import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  PaginationQueryDto,
  TrimmedOptionalString,
} from '../../../common/pagination/pagination.dto';

export class TeamListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  divisionId?: string;

  @IsIn(['name', 'division', 'recent'])
  @IsOptional()
  sortBy?: 'division' | 'name' | 'recent';

  @IsOptional()
  @TrimmedOptionalString()
  search?: string;

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';
}
