import { BadRequestException } from '@nestjs/common';
import {
  AUTH_ROLES,
  type AuthRole,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { InvitationService } from './invitation.service';

const access: OrganizationAccessContext = {
  membershipId: 'owner-member-1',
  organizationId: 'org-1',
  permissions: ['members.manage'],
  role: AUTH_ROLES.OWNER,
  userId: 'user-owner-1',
};

const invitation = {
  accepted_at: null,
  accepted_by_member_id: null,
  created_at: new Date('2026-08-01T00:00:00.000Z'),
  email: 'manager@example.com',
  expires_at: new Date('2026-08-08T00:00:00.000Z'),
  id: 'invitation-1',
  invited_by_member_id: 'owner-member-1',
  organization_id: 'org-1',
  revoked_at: null,
  role: AUTH_ROLES.TEAM_MANAGER,
  status: 'pending',
  token_hash: 'stored-hash',
  updated_at: new Date('2026-08-01T00:00:00.000Z'),
};

function createQuery({
  rows = [],
  first,
}: {
  rows?: unknown[];
  first?: unknown;
} = {}) {
  const query: any = {
    execute: jest.fn().mockResolvedValue(rows),
    executeTakeFirst: jest.fn().mockResolvedValue(first ?? rows[0]),
  };

  for (const method of [
    'innerJoin',
    'leftJoin',
    'orderBy',
    'select',
    'selectAll',
    'where',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }

  return query;
}

function createInvitationService() {
  const organizationQuery = createQuery({
    first: { name: 'League One', slug: 'league-one' },
  });
  const duplicateQuery = createQuery();
  const auditExecute = jest.fn().mockResolvedValue([]);
  const invitationInsertExecute = jest.fn().mockResolvedValue(invitation);
  const assignmentInsertExecute = jest.fn().mockResolvedValue([]);
  const transactionExecute = jest.fn(async (callback) =>
    callback({
      deleteFrom: jest.fn().mockReturnValue({
        execute: jest.fn().mockResolvedValue([]),
        where: jest.fn().mockReturnThis(),
      }),
      insertInto: jest.fn((table: string) => {
        if (table === 'access.organization_invitations') {
          return {
            executeTakeFirstOrThrow: invitationInsertExecute,
            returningAll: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
          };
        }

        return {
          execute: assignmentInsertExecute,
          values: jest.fn().mockReturnThis(),
        };
      }),
    }),
  );
  const db: any = {
    insertInto: jest.fn().mockReturnValue({
      execute: auditExecute,
      values: jest.fn().mockReturnThis(),
    }),
    selectFrom: jest.fn((table: string) =>
      table === 'admin.organizations' ? organizationQuery : duplicateQuery,
    ),
    transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
  };
  const policy = {
    resolve: jest.fn().mockResolvedValue([
      {
        id: 'team-1',
        league_season_id: 'season-1',
        league_season_name: '2026 season',
        name: 'Falcons',
        slug: 'falcons',
      },
    ]),
  };
  const mailer = { sendInvitation: jest.fn().mockResolvedValue(undefined) };
  const tokenService = {
    createTokenPair: jest
      .fn()
      .mockReturnValue({ token: 'plain-token', tokenHash: 'hash' }),
    hashToken: jest.fn().mockReturnValue('stored-hash'),
    normalizeEmail: jest.fn((email: string) => email.trim().toLowerCase()),
  };

  return {
    assignmentInsertExecute,
    auditExecute,
    db,
    mailer,
    policy,
    service: new InvitationService(
      db,
      mailer as never,
      tokenService as never,
      policy as never,
    ),
    tokenService,
    transactionExecute,
  };
}

function createAcceptanceService(role: AuthRole = AUTH_ROLES.TEAM_MANAGER) {
  const invitationByToken = createQuery({
    first: {
      accepted_at: null,
      accepted_by_member_id: null,
      created_at: new Date('2026-08-01T00:00:00.000Z'),
      email: 'manager@example.com',
      expires_at: new Date('2026-08-20T00:00:00.000Z'),
      id: 'invitation-1',
      invited_by_member_id: 'owner-member-1',
      organization_id: 'org-1',
      revoked_at: null,
      role,
      status: 'pending',
      accepted_user_id: null,
      organization_name: 'League One',
      organization_slug: 'league-one',
    },
  });
  const memberQuery = createQuery();
  const notificationRecipientQuery = createQuery({
    rows: [{ user_id: 'user-owner-1' }, { user_id: 'user-inviter-1' }],
  });
  const assignmentQuery = createQuery({
    rows: [
      {
        id: 'team-1',
        invitation_id: 'invitation-1',
        league_season_id: 'season-1',
        league_season_name: '2026 season',
        name: 'Falcons',
        slug: 'falcons',
      },
    ],
  });
  const member = {
    id: 'member-1',
    organization_id: 'org-1',
    role,
    status: 'active',
    user_id: 'user-manager-1',
  };
  const insertedTeamAssignments: unknown[] = [];
  const deletedTables: string[] = [];
  const transactionExecute = jest.fn(async (callback) =>
    callback({
      deleteFrom: jest.fn((table: string) => {
        deletedTables.push(table);
        return {
          execute: jest.fn().mockResolvedValue([]),
          where: jest.fn().mockReturnThis(),
        };
      }),
      insertInto: jest.fn((table: string) => {
        if (table === 'admin.organization_members') {
          return {
            executeTakeFirstOrThrow: jest.fn().mockResolvedValue(member),
            returningAll: jest.fn().mockReturnThis(),
            values: jest.fn().mockReturnThis(),
          };
        }

        return {
          execute: jest.fn().mockResolvedValue([]),
          values: jest.fn((values: unknown) => {
            if (table === 'access.team_manager_assignments') {
              insertedTeamAssignments.push(values);
            }
            return { execute: jest.fn().mockResolvedValue([]) };
          }),
        };
      }),
      selectFrom: jest.fn((table: string) =>
        table === 'admin.organization_members'
          ? memberQuery
          : table === 'admin.organization_members as recipients'
            ? notificationRecipientQuery
            : assignmentQuery,
      ),
      updateTable: jest.fn().mockReturnValue({
        execute: jest.fn().mockResolvedValue([]),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      }),
    }),
  );
  const db: any = {
    selectFrom: jest.fn((table: string) => {
      if (table === 'admin.organization_members as members') {
        return notificationRecipientQuery;
      }

      if (table === 'admin.organizations as organizations') {
        return createQuery({
          first: { name: 'League One', slug: 'league-one' },
        });
      }

      if (table === 'access.invitation_team_assignments as assignments') {
        return assignmentQuery;
      }

      return invitationByToken;
    }),
    transaction: jest.fn().mockReturnValue({ execute: transactionExecute }),
  };
  const tokenService = {
    hashToken: jest.fn().mockReturnValue('stored-hash'),
    normalizeEmail: jest.fn((email: string) => email.trim().toLowerCase()),
  };
  const policy = { resolve: jest.fn() };
  const mailer = { sendInvitation: jest.fn() };
  const notificationWriter = {
    clearInvitationActions: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue([]),
  };

  return {
    deletedTables,
    insertedTeamAssignments,
    notificationWriter,
    service: new InvitationService(
      db,
      mailer as never,
      tokenService as never,
      policy as never,
      notificationWriter as never,
    ),
  };
}

describe('InvitationService team manager scope', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stores and returns selected team assignments when creating an invitation', async () => {
    const { assignmentInsertExecute, policy, service } =
      createInvitationService();

    await expect(
      service.create('org-1', access, {
        email: ' Manager@Example.com ',
        role: AUTH_ROLES.TEAM_MANAGER,
        teamIds: ['team-1'],
      }),
    ).resolves.toMatchObject({
      email: 'manager@example.com',
      role: AUTH_ROLES.TEAM_MANAGER,
      teamAssignments: [
        expect.objectContaining({ id: 'team-1', name: 'Falcons' }),
      ],
    });

    expect(policy.resolve).toHaveBeenCalledWith(
      'org-1',
      AUTH_ROLES.TEAM_MANAGER,
      ['team-1'],
    );
    expect(assignmentInsertExecute).toHaveBeenCalled();
  });

  it('allows an explicitly unassigned team manager invitation', async () => {
    const { policy, service } = createInvitationService();
    policy.resolve.mockResolvedValue([]);

    await expect(
      service.create('org-1', access, {
        email: 'manager@example.com',
        role: AUTH_ROLES.TEAM_MANAGER,
      }),
    ).resolves.toMatchObject({ teamAssignments: [] });

    expect(policy.resolve).toHaveBeenCalledWith(
      'org-1',
      AUTH_ROLES.TEAM_MANAGER,
      [],
    );
  });

  it('rejects editing an expired pending invitation', async () => {
    const { db, service } = createInvitationService();
    const expiredInvitation = {
      ...invitation,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
    };
    const query = createQuery({ first: expiredInvitation });
    db.selectFrom.mockReturnValue(query);

    await expect(
      service.update('org-1', 'invitation-1', access, {
        role: AUTH_ROLES.TEAM_MANAGER,
        teamIds: [],
      }),
    ).rejects.toThrow(
      new BadRequestException('Only active pending invitations can be edited'),
    );
  });

  it('activates the selected team assignments with the accepted membership', async () => {
    const { insertedTeamAssignments, service } = createAcceptanceService();

    await expect(
      service.accept(
        { token: 'plain-token' },
        { id: 'user-manager-1', email: 'manager@example.com', name: 'Manager' },
      ),
    ).resolves.toEqual({ membershipId: 'member-1', success: true });

    expect(insertedTeamAssignments).toEqual([
      [
        {
          league_season_id: 'season-1',
          organization_member_id: 'member-1',
          team_id: 'team-1',
        },
      ],
    ]);
  });

  it('accepts an email-matched invitation by id for authenticated inbox actions', async () => {
    const { service } = createAcceptanceService();

    await expect(
      service.acceptById('invitation-1', {
        id: 'user-manager-1',
        email: 'manager@example.com',
        name: 'Manager',
      }),
    ).resolves.toEqual({ membershipId: 'member-1', success: true });
  });

  it('notifies the inviter and current owner after an invitation is accepted', async () => {
    const { notificationWriter, service } = createAcceptanceService();

    await service.accept(
      { token: 'plain-token' },
      { id: 'user-manager-1', email: 'manager@example.com', name: 'Manager' },
    );

    expect(notificationWriter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          memberName: 'Manager',
          organizationName: 'League One',
          organizationSlug: 'league-one',
        }),
        dedupeKey: 'invitation:invitation-1:accepted',
        eventType: 'access.invitation_accepted',
        organizationId: 'org-1',
        recipients: [{ userId: 'user-owner-1' }, { userId: 'user-inviter-1' }],
      }),
      expect.anything(),
    );
  });

  it('clears old assignments when a non-manager invitation is accepted', async () => {
    const { deletedTables, insertedTeamAssignments, service } =
      createAcceptanceService(AUTH_ROLES.ADMIN);

    await service.accept(
      { token: 'plain-token' },
      { id: 'user-manager-1', email: 'manager@example.com', name: 'Manager' },
    );

    expect(deletedTables).toEqual([
      'access.team_manager_assignments',
      'access.game_scorekeeper_assignments',
      'access.game_statistician_assignments',
    ]);
    expect(insertedTeamAssignments).toEqual([]);
  });
});
