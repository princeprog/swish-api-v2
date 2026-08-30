import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

const MANAGEABLE_ROLES = [
  AUTH_ROLES.ADMIN,
  AUTH_ROLES.SCOREKEEPER,
  AUTH_ROLES.STATISTICIAN,
  AUTH_ROLES.TEAM_MANAGER,
] as const;

export class CreateOrganizationMemberDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsIn(MANAGEABLE_ROLES)
  role!: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: string;
}
