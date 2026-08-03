import { IsString, Length } from 'class-validator';

export class StartAmendmentDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
