import { IsUUID } from 'class-validator';

export class CompleteComplianceUploadDto {
  @IsUUID()
  fileId!: string;
}
