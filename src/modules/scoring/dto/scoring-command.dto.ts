import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class ScoringCommandDto {
  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsDateString()
  occurredAt!: string;

  @IsString()
  type!: string;

  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  controlToken?: string;
}

export class ClaimScoringControlDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceLabel?: string;
}

export class ScoringControlTokenDto {
  @IsString()
  controlToken!: string;
}

export class TakeoverScoringControlDto {
  @IsString()
  @MaxLength(400)
  reason!: string;

  @IsString()
  @IsOptional()
  @MaxLength(120)
  deviceLabel?: string;
}

export class ScoringEventsQueryDto {
  @IsInt()
  @IsOptional()
  beforeSequence?: number;

  @IsInt()
  @IsOptional()
  limit?: number;
}

export class ScoringParamsDto {
  @IsUUID()
  gameId!: string;

  @IsUUID()
  organizationId!: string;
}
