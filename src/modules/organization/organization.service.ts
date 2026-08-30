import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import {
  AUTH_ROLES,
  getPermissionsForOrganizationRole,
  type AuthRole,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(createOrganizationDto: CreateOrganizationDto, userId: string) {
    const existing = await this.db
      .selectFrom('admin.organizations')
      .select(['id'])
      .where('slug', '=', createOrganizationDto.slug)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException('Organization slug already exists');
    }

    return this.db.transaction().execute(async (trx) => {
      const organization = await trx
        .insertInto('admin.organizations')
        .values({
          name: createOrganizationDto.name,
          slug: createOrganizationDto.slug,
          status: createOrganizationDto.status ?? 'active',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('admin.organization_members')
        .values({
          organization_id: organization.id,
          role: AUTH_ROLES.OWNER,
          status: 'active',
          user_id: userId,
        })
        .execute();

      return organization;
    });
  }

  async findOne(organizationId: string) {
    const organization = await this.db
      .selectFrom('admin.organizations')
      .selectAll()
      .where('id', '=', organizationId)
      .executeTakeFirst();

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  findAll(userId: string) {
    return this.db
      .selectFrom('admin.organizations as organizations')
      .innerJoin(
        'admin.organization_members as organization_members',
        'organization_members.organization_id',
        'organizations.id',
      )
      .select([
        'organizations.created_at',
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.status',
        'organizations.updated_at',
        'organization_members.id as membership_id',
        'organization_members.role',
      ])
      .where('organization_members.user_id', '=', userId)
      .where('organization_members.status', '=', 'active')
      .orderBy('organizations.created_at asc')
      .execute()
      .then((organizations) =>
        organizations.map((organization) => ({
          created_at: organization.created_at,
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          updated_at: organization.updated_at,
          access: {
            membershipId: organization.membership_id,
            permissions: getPermissionsForOrganizationRole(
              organization.role as AuthRole,
            ),
            role: organization.role,
          },
        })),
      );
  }

  async update(
    organizationId: string,
    updateOrganizationDto: UpdateOrganizationDto,
  ) {
    const organization = await this.findOne(organizationId);

    if (
      updateOrganizationDto.slug &&
      updateOrganizationDto.slug !== organization.slug
    ) {
      const existing = await this.db
        .selectFrom('admin.organizations')
        .select(['id'])
        .where('slug', '=', updateOrganizationDto.slug)
        .executeTakeFirst();

      if (existing) {
        throw new ConflictException('Organization slug already exists');
      }
    }

    return this.db
      .updateTable('admin.organizations')
      .set({
        ...updateOrganizationDto,
        updated_at: new Date(),
      })
      .where('id', '=', organizationId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(organizationId: string, access: OrganizationAccessContext) {
    throw new ConflictException(
      'This record cannot be deleted. Archive support is being prepared so league history remains available.',
    );

    await this.findOne(organizationId);
    await this.writeAudit(
      access,
      'organization.deleted',
      'organization',
      organizationId,
      {},
    );

    await this.db
      .deleteFrom('admin.organizations')
      .where('id', '=', organizationId)
      .execute();

    return { success: true };
  }

  private async writeAudit(
    access: OrganizationAccessContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>,
  ) {
    await (this.db as any)
      .insertInto('access.audit_events')
      .values({
        action,
        actor_member_id: access.membershipId,
        metadata,
        organization_id: access.organizationId,
        target_id: targetId,
        target_type: targetType,
      })
      .execute();
  }
}
