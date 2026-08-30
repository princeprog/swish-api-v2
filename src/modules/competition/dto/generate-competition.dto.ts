import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class GenerateCompetitionDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  directSeedTeamIds?: string[];
}
