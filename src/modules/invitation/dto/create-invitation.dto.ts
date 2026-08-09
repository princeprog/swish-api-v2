import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

export class CreateInvitationDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsIn([AUTH_ROLES.ADMIN, AUTH_ROLES.TEAM_MANAGER, AUTH_ROLES.SCOREKEEPER])
  role!:
    | typeof AUTH_ROLES.ADMIN
    | typeof AUTH_ROLES.TEAM_MANAGER
    | typeof AUTH_ROLES.SCOREKEEPER;

  @IsArray()
  @ArrayUnique()
  @IsOptional()
  @IsUUID('4', { each: true })
  teamIds?: string[];
}
