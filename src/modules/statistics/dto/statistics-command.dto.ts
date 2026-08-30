import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RecordStatisticEventDto {
  @IsString()
  controlToken!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string;

  @IsDateString()
  occurredAt!: string;

  @ValidateIf((dto: RecordStatisticEventDto) => !dto.reversesEventId)
  @IsUUID()
  playerId?: string;

  @ValidateIf((dto: RecordStatisticEventDto) => !dto.reversesEventId)
  @IsIn(['points', 'rebound', 'assist', 'steal', 'turnover'])
  type?: 'points' | 'rebound' | 'assist' | 'steal' | 'turnover';

  @ValidateIf((dto: RecordStatisticEventDto) => !dto.reversesEventId)
  @IsInt()
  @Min(1)
  @Max(3)
  value?: number;

  @IsOptional()
  @IsUUID()
  reversesEventId?: string;
}

export class ClaimStatisticsControlDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceLabel?: string;
}

export class StatisticsControlTokenDto {
  @IsString()
  controlToken!: string;
}

export class TakeoverStatisticsControlDto extends ClaimStatisticsControlDto {
  @IsString()
  @MinLength(10)
  @MaxLength(400)
  reason!: string;
}

export class SubmitStatisticsDto extends StatisticsControlTokenDto {}

export class StatisticsOverrideDto {
  @IsString()
  @MinLength(10)
  @MaxLength(800)
  reason!: string;
}
