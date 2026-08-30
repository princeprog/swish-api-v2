import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RecordTieDecisionDto {
  @IsUUID()
  poolId!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  teamIds!: string[];

  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderedTeamIds!: string[];

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}
