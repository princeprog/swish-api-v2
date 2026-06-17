import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { AUTH_ROLES } from '../../common/auth/roles';
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
      ])
      .where('organization_members.user_id', '=', userId)
      .where('organization_members.status', '=', 'active')
      .orderBy('organizations.created_at asc')
      .execute();
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

  async remove(organizationId: string) {
    await this.findOne(organizationId);

    await this.db
      .deleteFrom('admin.organizations')
      .where('id', '=', organizationId)
      .execute();

    return { success: true };
  }
}
