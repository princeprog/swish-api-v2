import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class NotificationListQueryDto {
  @IsOptional()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;

  @IsOptional()
  @IsIn(['all', 'unread'])
  status?: 'all' | 'unread';

  @IsOptional()
  @IsIn(['access', 'roster', 'schedule', 'scoring', 'competition'])
  category?: 'access' | 'roster' | 'schedule' | 'scoring' | 'competition';

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
