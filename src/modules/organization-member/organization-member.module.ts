import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizationMemberService } from './organization-member.service';
import { OrganizationMemberController } from './organization-member.controller';
import { OwnershipController } from './ownership.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OrganizationMemberController, OwnershipController],
  providers: [OrganizationMemberService],
})
export class OrganizationMemberModule {}
