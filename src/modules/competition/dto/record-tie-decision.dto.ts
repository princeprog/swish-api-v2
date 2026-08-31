import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Min,
} from 'class-validator';

export class RecordTieDecisionDto {
  @IsInt()
  @Min(1)
  expectedStandingsRevision!: number;

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
