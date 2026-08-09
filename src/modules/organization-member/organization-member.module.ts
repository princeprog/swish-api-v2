import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { OrganizationMemberService } from './organization-member.service';
import { OrganizationMemberController } from './organization-member.controller';
import { OwnershipController } from './ownership.controller';
import { TeamAssignmentPolicyService } from './team-assignment-policy.service';

@Module({
  imports: [DatabaseModule, AuthModule, NotificationModule],
  controllers: [OrganizationMemberController, OwnershipController],
  providers: [OrganizationMemberService, TeamAssignmentPolicyService],
  exports: [TeamAssignmentPolicyService],
})
export class OrganizationMemberModule {}
