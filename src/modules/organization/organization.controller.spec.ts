import { OrganizationController } from './organization.controller';
import type { OrganizationService } from './organization.service';

const organization = {
  id: 'org-1',
  name: 'Swish League',
  slug: 'swish-league',
  status: 'active',
};

function createController() {
  const organizationService = {
    create: jest.fn(),
    findOne: jest.fn(),
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
});
