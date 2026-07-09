import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUTH_ROLES } from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreateOrganizationMemberDto } from './dto/create-organization-member.dto';
import { UpdateOrganizationMemberDto } from './dto/update-organization-member.dto';

@Injectable()
export class OrganizationMemberService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    organizationId: string,
    createOrganizationMemberDto: CreateOrganizationMemberDto,
  ) {
    await this.assertOrganizationExists(organizationId);
    await this.assertUserExists(createOrganizationMemberDto.userId);

    const existing = await this.db
      .selectFrom('admin.organization_members')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', createOrganizationMemberDto.userId)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException(
        'User is already a member of this organization',
      );
    }

    return this.db
      .insertInto('admin.organization_members')
      .values({
        organization_id: organizationId,
        role: createOrganizationMemberDto.role,
        status: createOrganizationMemberDto.status ?? 'active',
        user_id: createOrganizationMemberDto.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findAll(organizationId: string) {
    return this.db
      .selectFrom('admin.organization_members')
      .selectAll()
      .where('organization_id', '=', organizationId)
      .orderBy('created_at asc')
      .execute();
  }

  async findOne(organizationId: string, memberId: string) {
    const member = await this.db
      .selectFrom('admin.organization_members')
      .selectAll()
      .where('id', '=', memberId)
      .where('organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!member) {
      throw new NotFoundException('Organization member not found');
    }

    return member;
  }

  async update(
    organizationId: string,
    memberId: string,
    updateOrganizationMemberDto: UpdateOrganizationMemberDto,
  ) {
    const member = await this.findOne(organizationId, memberId);

    if (
      member.role === AUTH_ROLES.OWNER &&
      updateOrganizationMemberDto.role &&
      updateOrganizationMemberDto.role !== AUTH_ROLES.OWNER
    ) {
      await this.assertAnotherOwnerExists(organizationId, memberId);
    }

    if (
      member.role === AUTH_ROLES.OWNER &&
      updateOrganizationMemberDto.status &&
      updateOrganizationMemberDto.status !== 'active'
    ) {
      await this.assertAnotherOwnerExists(organizationId, memberId);
    }

    return this.db
      .updateTable('admin.organization_members')
      .set({
        role: updateOrganizationMemberDto.role,
        status: updateOrganizationMemberDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', memberId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(organizationId: string, memberId: string) {
    const member = await this.findOne(organizationId, memberId);

    if (member.role === AUTH_ROLES.OWNER) {
      await this.assertAnotherOwnerExists(organizationId, memberId);
    }

    await this.db
      .deleteFrom('admin.organization_members')
      .where('id', '=', memberId)
      .execute();

    return { success: true };
  }

  private async assertAnotherOwnerExists(
    organizationId: string,
    memberId: string,
  ): Promise<void> {
    const anotherOwner = await this.db
      .selectFrom('admin.organization_members')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('id', '!=', memberId)
      .where('role', '=', AUTH_ROLES.OWNER)
      .where('status', '=', 'active')
      .executeTakeFirst();

    if (!anotherOwner) {
      throw new BadRequestException(
        'Organization must keep at least one active owner',
      );
    }
  }

  private async assertOrganizationExists(
    organizationId: string,
  ): Promise<void> {
    const organization = await this.db
      .selectFrom('admin.organizations')
      .select(['id'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['id'])
      .where('id', '=', userId)
      .executeTakeFirst();

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
