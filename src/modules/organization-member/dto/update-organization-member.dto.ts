import { IsIn, IsOptional, IsString } from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

export class UpdateOrganizationMemberDto {
  @IsOptional()
  @IsString()
  @IsIn(Object.values(AUTH_ROLES))
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;
}
