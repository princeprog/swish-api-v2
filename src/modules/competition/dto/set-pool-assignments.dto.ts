import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsUUID,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export class PoolTeamAssignmentDto {
  @IsUUID()
  poolId!: string;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  teamIds!: string[];
}

@ValidatorConstraint({ name: 'uniqueTeamsAcrossPools', async: false })
class UniqueTeamsAcrossPoolsConstraint implements ValidatorConstraintInterface {
  validate(value: PoolTeamAssignmentDto[]): boolean {
    if (!Array.isArray(value)) return false;
    const teamIds = value.flatMap((pool) => pool.teamIds ?? []);
    return new Set(teamIds).size === teamIds.length;
  }

  defaultMessage(): string {
    return 'A team can only be assigned to one pool.';
  }
}

export class SetPoolAssignmentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PoolTeamAssignmentDto)
  @Validate(UniqueTeamsAcrossPoolsConstraint)
  pools!: PoolTeamAssignmentDto[];
}
