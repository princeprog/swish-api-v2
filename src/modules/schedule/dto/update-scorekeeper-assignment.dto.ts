import { IsUUID, ValidateIf } from 'class-validator';

export class UpdateScorekeeperAssignmentDto {
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  scorekeeperMemberId!: string | null;
}
