import { IsIn, IsOptional, IsString } from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

const MANAGEABLE_ROLES = [
  AUTH_ROLES.ADMIN,
  AUTH_ROLES.SCOREKEEPER,
  AUTH_ROLES.STATISTICIAN,
  AUTH_ROLES.TEAM_MANAGER,
] as const;

export class UpdateOrganizationMemberDto {
  @IsOptional()
  @IsString()
  @IsIn(MANAGEABLE_ROLES)
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: string;
}
