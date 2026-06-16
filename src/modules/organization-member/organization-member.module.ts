import { Module } from '@nestjs/common';
import { OrganizationMemberService } from './organization-member.service';
import { OrganizationMemberController } from './organization-member.controller';

@Module({
  controllers: [OrganizationMemberController],
  providers: [OrganizationMemberService],
})
export class OrganizationMemberModule {}
