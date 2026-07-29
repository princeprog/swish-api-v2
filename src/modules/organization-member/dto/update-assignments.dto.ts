import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class UpdateTeamAssignmentsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  teamIds!: string[];
}

export class UpdateGameAssignmentsDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  gameIds!: string[];
}
