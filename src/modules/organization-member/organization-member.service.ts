import { Injectable } from '@nestjs/common';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Injectable()
export class OrganizationMemberService {
  create(createOrganizationMemberDto: CreateOrganizationMemberDto) {
    return 'This action adds a new organizationMember';
  }

  findAll() {
    return `This action returns all organizationMember`;
  }

  findOne(id: number) {
    return `This action returns a #${id} organizationMember`;
  }

  update(id: number, updateOrganizationMemberDto: UpdateOrganizationMemberDto) {
    return `This action updates a #${id} organizationMember`;
  }

  remove(id: number) {
    return `This action removes a #${id} organizationMember`;
  }
}
