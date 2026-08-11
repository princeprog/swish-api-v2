import {
  IsInt,
  IsIn,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PrepareComplianceUploadDto {
  @IsInt()
  @Min(1)
  @Max(5)
  fileOrder!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalFilename!: string;

  @IsIn(['application/pdf', 'image/jpeg', 'image/png'])
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(10 * 1024 * 1024)
  byteSize!: number;

  @Matches(/^[a-f0-9]{64}$/i)
  sha256!: string;
}
