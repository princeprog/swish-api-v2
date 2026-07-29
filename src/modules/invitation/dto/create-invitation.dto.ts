import { IsEmail, IsIn, IsString } from 'class-validator';
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
}
