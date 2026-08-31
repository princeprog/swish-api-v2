import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class ScoringCommandDto {
  @IsString({ message: 'Enter a valid scoring request reference.' })
  @MaxLength(120, { message: 'The scoring request reference is too long.' })
  @Matches(/\S/, { message: 'Enter a valid scoring request reference.' })
  idempotencyKey!: string;

  @IsInt({ message: 'The game changed. Refresh it and try again.' })
  @Min(0, { message: 'The game changed. Refresh it and try again.' })
  expectedVersion!: number;

  @IsDateString({}, { message: 'Choose a valid game time and try again.' })
  occurredAt!: string;

  @IsString({ message: 'Choose a scoring action.' })
  @MaxLength(80, { message: 'Choose a valid scoring action.' })
  @Matches(/\S/, { message: 'Choose a scoring action.' })
  type!: string;

  @IsObject({ message: 'This scoring action is missing required information.' })
  @IsOptional()
  payload?: Record<string, unknown>;

  @IsString({ message: 'Your scoring control is no longer valid. Claim control again.' })
  @IsOptional()
  @MaxLength(512, { message: 'Your scoring control is no longer valid. Claim control again.' })
  @Matches(/\S/, { message: 'Your scoring control is no longer valid. Claim control again.' })
  controlToken?: string;
}

export class ClaimScoringControlDto {
  @IsString({ message: 'Enter a device name.' })
  @IsOptional()
  @MaxLength(120, { message: 'The device name is too long.' })
  @Matches(/\S/, { message: 'Enter a device name.' })
  deviceLabel?: string;
}

export class ScoringControlTokenDto {
  @IsString({ message: 'Your scoring control is no longer valid. Claim control again.' })
  @MaxLength(512, { message: 'Your scoring control is no longer valid. Claim control again.' })
  @Matches(/\S/, { message: 'Your scoring control is no longer valid. Claim control again.' })
  controlToken!: string;
}

export class TakeoverScoringControlDto {
  @IsString({ message: 'Add a reason for taking control.' })
  @MaxLength(400, { message: 'The reason is too long.' })
  @Matches(/\S/, { message: 'Add a reason for taking control.' })
  reason!: string;

  @IsString({ message: 'Enter a device name.' })
  @IsOptional()
  @MaxLength(120, { message: 'The device name is too long.' })
  @Matches(/\S/, { message: 'Enter a device name.' })
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
