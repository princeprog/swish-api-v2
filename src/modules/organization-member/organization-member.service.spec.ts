import { BadRequestException } from '@nestjs/common';
import { AUTH_ROLES, type OrganizationAccessContext } from '../../common/auth/roles';
import { OrganizationMemberService } from './organization-member.service';

const access: OrganizationAccessContext = {
  membershipId: 'owner-member-1',
  organizationId: 'org-1',
  permissions: ['members.manage'],
  role: AUTH_ROLES.OWNER,
  userId: 'user-owner-1',
};

function createService() {
  const deleteExecute = jest.fn().mockResolvedValue([]);
  const insertExecute = jest.fn().mockResolvedValue([]);
  const auditExecute = jest.fn().mockResolvedValue([]);
  const insertValues = jest.fn().mockReturnValue({ execute: insertExecute });
  const transactionExecute = jest.fn(async (callback) =>
    callback({
      deleteFrom: jest.fn().mockReturnValue({
        execute: deleteExecute,
        where: jest.fn().mockReturnThis(),
      }),
      insertInto: jest.fn().mockReturnValue({
        values: insertValues,
      }),
    }),
  );
  const db = {
    insertInto: jest.fn().mockReturnValue({
      execute: auditExecute,
      values: jest.fn().mockReturnThis(),
    }),
    selectFrom: jest.fn(),
    transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
  };
  const service = new OrganizationMemberService(db as never);

  jest.spyOn(service, 'findOne').mockResolvedValue({
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    id: 'member-1',
    organization_id: 'org-1',
    role: AUTH_ROLES.TEAM_MANAGER,
    status: 'active',
    updated_at: new Date('2026-07-01T00:00:00.000Z'),
    user_id: 'user-manager-1',
  });

  return {
    db,
    insertValues,
    service,
    transactionExecute,
  };
}

describe('OrganizationMemberService team manager assignments', () => {
  it('rejects assigning two teams in the same season to one manager', async () => {
    const { service, transactionExecute } = createService();
    jest
      .spyOn(service as never, 'findAssignableTeams')
      .mockResolvedValue([
        { id: 'team-1', league_season_id: 'season-1' },
        { id: 'team-2', league_season_id: 'season-1' },
      ] as never);

    await expect(
      service.updateTeamAssignments('org-1', 'member-1', access, [
        'team-1',
        'team-2',
      ]),
    ).rejects.toThrow(
      new BadRequestException(
        'A team manager can only manage one team in each season.',
      ),
    );
    expect(transactionExecute).not.toHaveBeenCalled();
  });

  it('allows assigning different teams in different seasons', async () => {
    const { insertValues, service } = createService();
    jest
      .spyOn(service as never, 'findAssignableTeams')
      .mockResolvedValue([
        { id: 'team-1', league_season_id: 'season-1' },
        { id: 'team-2', league_season_id: 'season-2' },
      ] as never);

    await expect(
      service.updateTeamAssignments('org-1', 'member-1', access, [
        'team-1',
        'team-2',
      ]),
    ).resolves.toEqual({ success: true, teamIds: ['team-1', 'team-2'] });
    expect(insertValues).toHaveBeenCalledWith([
      {
        league_season_id: 'season-1',
        organization_member_id: 'member-1',
        team_id: 'team-1',
      },
      {
        league_season_id: 'season-2',
        organization_member_id: 'member-1',
        team_id: 'team-2',
      },
    ]);
  });
});
