import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

export class UpdateInvitationDto {
  @IsIn([
    AUTH_ROLES.ADMIN,
    AUTH_ROLES.TEAM_MANAGER,
    AUTH_ROLES.SCOREKEEPER,
    AUTH_ROLES.STATISTICIAN,
  ])
  role!:
    | typeof AUTH_ROLES.ADMIN
    | typeof AUTH_ROLES.TEAM_MANAGER
    | typeof AUTH_ROLES.SCOREKEEPER
    | typeof AUTH_ROLES.STATISTICIAN;

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  teamIds!: string[];
}
