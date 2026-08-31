import { OrganizationMemberController } from './organization-member.controller';
import type { OrganizationMemberService } from './organization-member.service';

const membership = {
  created_at: new Date('2026-06-17T00:00:00.000Z'),
  email: 'member@example.com',
  id: 'member-1',
  name: 'League Member',
  organization_id: 'org-1',
  role: 'admin',
  status: 'active',
  updated_at: new Date('2026-06-17T00:00:00.000Z'),
  user_id: 'user-2',
  teamAssignments: [],
};

const access = {
  membershipId: 'owner-member-1',
  organizationId: 'org-1',
  permissions: ['members.manage'],
  role: 'owner',
  userId: 'user-1',
};

function createController() {
  const organizationMemberService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    updateGameAssignments: jest.fn(),
    updateTeamAssignments: jest.fn(),
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
      controller.create('org-1', access as never, {
        role: 'admin',
        userId: 'user-2',
      }),
    ).resolves.toEqual(membership);

    expect(organizationMemberService.create).toHaveBeenCalledWith(
      'org-1',
      access,
      {
        role: 'admin',
        userId: 'user-2',
      },
    );
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
      role: 'team_manager',
    });

    await expect(
      controller.update('org-1', 'member-1', access as never, {
        role: 'team_manager',
      }),
    ).resolves.toEqual({
      ...membership,
      role: 'team_manager',
    });
    expect(organizationMemberService.update).toHaveBeenCalledWith(
      'org-1',
      'member-1',
      access,
      {
        role: 'team_manager',
      },
    );
  });

  it('updates team assignments within the organization scope', async () => {
    const { controller, organizationMemberService } = createController();

    organizationMemberService.updateTeamAssignments.mockResolvedValue({
      success: true,
      teamIds: ['team-1'],
    });

    await expect(
      controller.updateTeamAssignments('org-1', 'member-1', access as never, {
        teamIds: ['team-1'],
      }),
    ).resolves.toEqual({
      success: true,
      teamIds: ['team-1'],
    });
    expect(
      organizationMemberService.updateTeamAssignments,
    ).toHaveBeenCalledWith('org-1', 'member-1', access, ['team-1']);
  });
});
