import { IsString, Length } from 'class-validator';

export class ReturnRosterDto {
  @IsString()
  @Length(3, 500)
  reason!: string;
}
