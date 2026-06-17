import { OrganizationMemberController } from './organization-member.controller';
import type { OrganizationMemberService } from './organization-member.service';

const membership = {
  created_at: new Date('2026-06-17T00:00:00.000Z'),
  id: 'member-1',
  organization_id: 'org-1',
  role: 'admin',
  status: 'active',
  updated_at: new Date('2026-06-17T00:00:00.000Z'),
  user_id: 'user-2',
};

function createController() {
  const organizationMemberService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
  } as unknown as jest.Mocked<OrganizationMemberService>;

  return {
    controller: new OrganizationMemberController(organizationMemberService),
    organizationMemberService,
  };
}

describe('OrganizationMemberController', () => {
  it('creates an organization member within the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.create.mockResolvedValue(membership);

    await expect(
      controller.create('org-1', {
        role: 'admin',
        userId: 'user-2',
      }),
    ).resolves.toEqual(membership);

    expect(organizationMemberService.create).toHaveBeenCalledWith('org-1', {
      role: 'admin',
      userId: 'user-2',
    });
  });

  it('lists members in the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.findAll.mockResolvedValue([membership]);

    await expect(controller.findAll('org-1')).resolves.toEqual([membership]);
    expect(organizationMemberService.findAll).toHaveBeenCalledWith('org-1');
  });

  it('gets one organization member within the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.findOne.mockResolvedValue(membership);

    await expect(controller.findOne('org-1', 'member-1')).resolves.toEqual(
      membership,
    );
    expect(organizationMemberService.findOne).toHaveBeenCalledWith(
      'org-1',
      'member-1',
    );
  });

  it('updates one organization member within the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.update.mockResolvedValue({
      ...membership,
      role: 'coach',
    });

    await expect(
      controller.update('org-1', 'member-1', {
        role: 'coach',
      }),
    ).resolves.toEqual({
      ...membership,
      role: 'coach',
    });
    expect(organizationMemberService.update).toHaveBeenCalledWith(
      'org-1',
      'member-1',
      {
        role: 'coach',
      },
    );
  });

  it('removes one organization member within the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.remove.mockResolvedValue({ success: true });

    await expect(controller.remove('org-1', 'member-1')).resolves.toEqual({
      success: true,
    });
    expect(organizationMemberService.remove).toHaveBeenCalledWith(
      'org-1',
      'member-1',
    );
  });
});
