import { IsString, IsUUID } from 'class-validator';

export class TransferOwnershipDto {
  @IsUUID()
  targetMemberId!: string;

  @IsString()
  confirmationSlug!: string;
}
