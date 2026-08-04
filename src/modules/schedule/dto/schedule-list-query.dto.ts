import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { TrimmedOptionalString } from '../../../common/pagination/pagination.dto';

export class ScheduleListQueryDto {
  @IsOptional()
  @IsUUID()
  divisionId?: string;

  @IsOptional()
  @IsUUID()
  leagueSeasonId?: string;

  @IsOptional()
  @TrimmedOptionalString()
  search?: string;

  @IsIn(['date', 'division', 'venue'])
  @IsOptional()
  sortBy?: 'date' | 'division' | 'venue';

  @IsIn([
    'draft',
    'scheduled',
    'live',
    'final',
    'reopened',
    'postponed',
    'cancelled',
  ])
  @IsOptional()
  status?:
    | 'draft'
    | 'scheduled'
    | 'live'
    | 'final'
    | 'reopened'
    | 'postponed'
    | 'cancelled';
}
