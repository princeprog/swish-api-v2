import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ConfirmPlayerOfGameDto {
  @IsUUID()
  playerId!: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(800)
  reason?: string;
}
