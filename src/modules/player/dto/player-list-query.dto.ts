import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  PaginationQueryDto,
  TrimmedOptionalString,
} from '../../../common/pagination/pagination.dto';

export class PlayerListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  divisionId?: string;

  @IsIn([
    'division',
    'jerseyNumber',
    'name',
    'position',
    'recent',
    'status',
    'team',
    'updated',
  ])
  @IsOptional()
  sortBy?:
    | 'division'
    | 'jerseyNumber'
    | 'name'
    | 'position'
    | 'recent'
    | 'status'
    | 'team'
    | 'updated';

  @IsIn(['asc', 'desc'])
  @IsOptional()
  sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @TrimmedOptionalString()
  search?: string;

  @IsIn(['active', 'inactive'])
  @IsOptional()
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
