import { OrganizationController } from './organization.controller';
import type { OrganizationService } from './organization.service';

const organization = {
  access: {
    membershipId: 'member-1',
    permissions: [],
    role: 'owner',
  },
  archived_at: null,
  created_at: new Date('2026-06-17T00:00:00.000Z'),
  id: 'org-1',
  name: 'Swish League',
  slug: 'swish-league',
  status: 'active',
  updated_at: new Date('2026-06-17T00:00:00.000Z'),
};

const access = {
  membershipId: 'member-1',
  organizationId: 'org-1',
  permissions: ['organization.manage'],
  role: 'owner',
  userId: 'user-1',
};

function createController() {
  const organizationService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<OrganizationService>;

  return {
    controller: new OrganizationController(organizationService),
    organizationService,
  };
}

describe('OrganizationController', () => {
  it('creates an organization for the authenticated user', async () => {
    const { controller, organizationService } = createController();
    const user = {
      email: 'owner@example.com',
      id: 'user-1',
      name: 'Owner',
    };

    organizationService.create.mockResolvedValue(organization);

    await expect(
      controller.create(
        {
          name: organization.name,
          slug: organization.slug,
        },
        user,
      ),
    ).resolves.toEqual(organization);

    expect(organizationService.create).toHaveBeenCalledWith(
      {
        name: organization.name,
        slug: organization.slug,
      },
      user.id,
    );
  });

  it('lists organizations for the authenticated user', async () => {
    const { controller, organizationService } = createController();
    const user = {
      email: 'owner@example.com',
      id: 'user-1',
      name: 'Owner',
    };

    organizationService.findAll.mockResolvedValue([organization]);

    await expect(controller.findAll(user)).resolves.toEqual([organization]);
    expect(organizationService.findAll).toHaveBeenCalledWith(user.id);
  });

  it('removes an organization', async () => {
    const { controller, organizationService } = createController();

    organizationService.remove.mockResolvedValue({ success: true });

    await expect(controller.remove('org-1', access as never)).resolves.toEqual({
      success: true,
    });
    expect(organizationService.remove).toHaveBeenCalledWith('org-1', access);
  });
});
