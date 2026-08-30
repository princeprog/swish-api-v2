import {
  IsDateString,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class UpdateScheduleDto {
  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsUUID()
  venueId?: string;

  @IsOptional()
  @IsIn(['draft', 'scheduled', 'postponed', 'cancelled'])
  status?: 'draft' | 'scheduled' | 'postponed' | 'cancelled';
}
