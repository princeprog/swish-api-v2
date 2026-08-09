import { IsOptional, IsUUID } from 'class-validator';

export class NotificationReadAllDto {
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
