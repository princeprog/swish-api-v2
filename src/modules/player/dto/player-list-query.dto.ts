import { IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  PaginationQueryDto,
  TrimmedOptionalString,
} from '../../../common/pagination/pagination.dto';

export class PlayerListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  divisionId?: string;

  @IsIn(['name', 'recent', 'team'])
  @IsOptional()
  sortBy?: 'name' | 'recent' | 'team';

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
