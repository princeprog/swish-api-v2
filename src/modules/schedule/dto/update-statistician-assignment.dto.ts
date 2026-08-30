import { IsUUID, ValidateIf } from 'class-validator';

export class UpdateStatisticianAssignmentDto {
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  statisticianMemberId!: string | null;
}
