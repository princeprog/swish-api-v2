import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { AUTH_ROLES } from '../../../common/auth/roles';

export class CreateOrganizationMemberDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @IsIn(Object.values(AUTH_ROLES))
  role!: string;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'inactive'])
  status?: string;
}
