/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  AUTH_ROLES,
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { ComplianceService } from './compliance.service';

const reviewerAccess: OrganizationAccessContext = {
  membershipId: 'admin-member',
  organizationId: 'org-1',
  permissions: [
    ORGANIZATION_PERMISSIONS.COMPLIANCE_REQUIREMENTS_MANAGE,
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_REVIEW,
  ],
  role: AUTH_ROLES.ADMIN,
  userId: 'admin-user',
};

const managerAccess: OrganizationAccessContext = {
  membershipId: 'manager-member',
  organizationId: 'org-1',
  permissions: [
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_READ_ASSIGNED,
    ORGANIZATION_PERMISSIONS.COMPLIANCE_SUBMISSIONS_SUBMIT_ASSIGNED,
  ],
  role: AUTH_ROLES.TEAM_MANAGER,
  userId: 'manager-user',
};

const settings = {
  archived_at: null,
  created_at: new Date('2026-08-11T00:00:00.000Z'),
  created_by_member_id: 'admin-member',
  division_id: 'division-1',
  id: 'settings-1',
  published_at: null,
  status: 'draft',
  updated_at: new Date('2026-08-11T00:00:00.000Z'),
};

const required = {
  archived_at: null,
  created_at: new Date('2026-08-11T00:00:00.000Z'),
  division_settings_id: 'settings-1',
  id: 'requirement-1',
  instructions: null,
  is_required: true,
  max_file_count: 1,
  response_type: 'short_text',
  sort_order: 0,
  title: 'Team contact confirmation',
  updated_at: new Date('2026-08-11T00:00:00.000Z'),
};

function createRepository(overrides: Record<string, unknown> = {}) {
  const repository = {
    addEvent: jest.fn().mockResolvedValue({ id: 'event-1' }),
    countAttempts: jest.fn().mockResolvedValue(0),
    createAttempt: jest.fn().mockImplementation(async (value) => ({
      id: 'attempt-1',
      submitted_at: new Date('2026-08-11T00:00:00.000Z'),
      ...value,
    })),
    createRequirement: jest.fn(),
    createSettings: jest.fn().mockResolvedValue(settings),
    ensureSubmission: jest
      .fn()
      .mockImplementation(async (teamId, requirementId) => ({
        id: `${teamId}-${requirementId}`,
        current_attempt_id: null,
        requirement_id: requirementId,
        review_note: null,
        reviewed_at: null,
        reviewed_by_member_id: null,
        submitted_at: null,
        submitted_by_member_id: null,
        team_id: teamId,
        waived_at: null,
        waived_by_member_id: null,
        waiver_expires_at: null,
        waiver_reason: null,
        workflow_status: 'draft',
      })),
    findDivisionContext: jest.fn().mockResolvedValue({
      division_id: 'division-1',
      division_name: 'Open Division',
      organization_id: 'org-1',
    }),
    findLatestDraftEvent: jest.fn().mockResolvedValue({
      metadata: { response: 'Coach Maria Santos', responseType: 'short_text' },
    }),
    findRequirement: jest.fn().mockResolvedValue(required),
    findSettingsByDivision: jest.fn().mockResolvedValue(settings),
    findTeamContext: jest.fn().mockResolvedValue({
      division_id: 'division-1',
      organization_id: 'org-1',
      team_id: 'team-1',
      team_name: 'Blue Eagles',
      team_status: 'active',
    }),
    getSubmission: jest.fn().mockResolvedValue({
      current_attempt_id: null,
      id: 'submission-1',
      requirement_id: 'requirement-1',
      team_id: 'team-1',
      waiver_expires_at: null,
      workflow_status: 'draft',
    }),
    isAssignedTeam: jest.fn().mockResolvedValue(true),
    listActiveTeams: jest
      .fn()
      .mockResolvedValue([{ id: 'team-1' }, { id: 'team-2' }]),
    listAttempts: jest.fn().mockResolvedValue([]),
    listAttemptFiles: jest.fn().mockResolvedValue([]),
    listDraftFiles: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    listRequirements: jest.fn().mockResolvedValue([required]),
    listSubmissionsForSettings: jest.fn().mockResolvedValue([]),
    listTeamSubmissions: jest.fn().mockResolvedValue([]),
    updateRequirement: jest.fn(),
    updateSettings: jest.fn().mockImplementation(async (_id, value) => ({
      ...settings,
      ...value,
    })),
    updateSubmission: jest.fn().mockImplementation(async (_id, value) => ({
      id: 'submission-1',
      requirement_id: 'requirement-1',
      team_id: 'team-1',
      ...value,
    })),
    upsertProjection: jest.fn(),
    withTransaction: jest.fn(async (work) => work(repository)),
    writeAudit: jest.fn(),
    ...overrides,
  };
  return repository;
}

describe('ComplianceService', () => {
  it('updates organizer instructions and the submission deadline', async () => {
    const repository = createRepository();
    const service = new ComplianceService(repository as never);

    await service.updateDivisionSettings(
      'org-1',
      'division-1',
      reviewerAccess,
      {
        instructions: 'Submit clear copies of each required document.',
        submissionDeadlineAt: '2026-09-01T08:00:00.000Z',
      },
    );

    expect(repository.updateSettings).toHaveBeenCalledWith(
      'settings-1',
      expect.objectContaining({
        instructions: 'Submit clear copies of each required document.',
        submission_deadline_at: new Date('2026-09-01T08:00:00.000Z'),
      }),
    );
    expect(repository.writeAudit).toHaveBeenCalledWith(
      reviewerAccess,
      'compliance.settings.updated',
      'division',
      'division-1',
      expect.objectContaining({
        deadlineChanged: true,
        instructionsChanged: true,
      }),
    );
  });

  it('publishes a draft and creates obligations for every active team', async () => {
    const repository = createRepository();
    const service = new ComplianceService(repository as never);

    await service.publishDivision('org-1', 'division-1', reviewerAccess);

    expect(repository.withTransaction).toHaveBeenCalledTimes(1);
    expect(repository.ensureSubmission).toHaveBeenCalledWith(
      'team-1',
      'requirement-1',
    );
    expect(repository.ensureSubmission).toHaveBeenCalledWith(
      'team-2',
      'requirement-1',
    );
    expect(repository.updateSettings).toHaveBeenCalledWith(
      'settings-1',
      expect.objectContaining({ status: 'published' }),
    );
    expect(repository.upsertProjection).toHaveBeenCalledTimes(2);
  });

  it('creates a new immutable attempt when a rejected item is resubmitted', async () => {
    const repository = createRepository({
      countAttempts: jest.fn().mockResolvedValue(1),
      createAttempt: jest.fn().mockImplementation(async (value) => ({
        id: 'attempt-2',
        submitted_at: new Date('2026-08-11T00:00:00.000Z'),
        ...value,
      })),
      ensureSubmission: jest.fn().mockResolvedValue({
        current_attempt_id: 'attempt-1',
        id: 'submission-1',
        requirement_id: 'requirement-1',
        team_id: 'team-1',
        waiver_expires_at: null,
        workflow_status: 'rejected',
      }),
    });
    const service = new ComplianceService(repository as never);

    await service.submitRequirement(
      'org-1',
      'team-1',
      'requirement-1',
      managerAccess,
    );

    expect(repository.createAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt_number: 2,
        response_type: 'short_text',
        response_value: 'Coach Maria Santos',
        submission_id: 'submission-1',
      }),
    );
    expect(repository.updateSubmission).toHaveBeenCalledWith(
      'submission-1',
      expect.objectContaining({
        current_attempt_id: 'attempt-2',
        workflow_status: 'submitted',
      }),
    );
  });

  it('returns every immutable attempt and event in history', async () => {
    const attempts = [
      { attempt_number: 1, id: 'attempt-1' },
      { attempt_number: 2, id: 'attempt-2' },
    ];
    const events = [{ event_type: 'submitted', id: 'event-1' }];
    const repository = createRepository({
      listAttempts: jest.fn().mockResolvedValue(attempts),
      listEvents: jest.fn().mockResolvedValue(events),
    });
    const service = new ComplianceService(repository as never);

    await expect(
      service.findHistory('org-1', 'team-1', 'requirement-1', managerAccess),
    ).resolves.toEqual({ attempts, events });
  });

  it('forwards review inbox scope, search, and pagination to the repository', async () => {
    const repository = createRepository({
      listReviewQueue: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    });
    const service = new ComplianceService(repository as never);

    await service.findReviewQueue('org-1', 'division-1', reviewerAccess, {
      page: 3,
      pageSize: 20,
      scope: 'needs_review',
      search: '  Eagles  ',
    });

    expect(repository.listReviewQueue).toHaveBeenCalledWith(
      'division-1',
      ['submitted', 'under_review'],
      'Eagles',
      { limit: 20, offset: 40, page: 3, pageSize: 20 },
    );
  });

  it('allows a reviewer to request changes and records the reason', async () => {
    const repository = createRepository({
      ensureSubmission: jest.fn().mockResolvedValue({
        current_attempt_id: 'attempt-1',
        id: 'submission-1',
        requirement_id: 'requirement-1',
        team_id: 'team-1',
        waiver_expires_at: null,
        workflow_status: 'submitted',
      }),
    });
    const service = new ComplianceService(repository as never);

    await service.requestChanges(
      'org-1',
      'team-1',
      'requirement-1',
      reviewerAccess,
      { reason: 'Please include the team manager name.' },
    );

    expect(repository.updateSubmission).toHaveBeenCalledWith(
      'submission-1',
      expect.objectContaining({
        review_note: 'Please include the team manager name.',
        workflow_status: 'rejected',
      }),
    );
    expect(repository.addEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'changes_requested' }),
    );
  });

  it('denies a team manager who is not assigned to the team', async () => {
    const repository = createRepository({
      isAssignedTeam: jest.fn().mockResolvedValue(false),
    });
    const service = new ComplianceService(repository as never);

    await expect(
      service.findTeamCompliance('org-1', 'team-1', managerAccess),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not reveal a team from another organization', async () => {
    const repository = createRepository({ findTeamContext: jest.fn() });
    const service = new ComplianceService(repository as never);

    await expect(
      service.findTeamCompliance('org-2', 'team-1', reviewerAccess),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns the latest saved response so managers can resume a draft', async () => {
    const repository = createRepository({
      findSettingsByDivision: jest.fn().mockResolvedValue({
        ...settings,
        published_at: new Date('2026-08-11T00:00:00.000Z'),
        status: 'published',
      }),
      findProjection: jest.fn().mockResolvedValue({ status: 'pending' }),
      listFilesForSubmission: jest.fn().mockResolvedValue([]),
      listTeamSubmissions: jest.fn().mockResolvedValue([
        {
          ...required,
          current_attempt_id: null,
          requirement_id: required.id,
          submission_id: 'submission-1',
          review_note: null,
          waiver_expires_at: null,
          workflow_status: 'draft',
        },
      ]),
    });
    const service = new ComplianceService(repository as never);

    const result = await service.findTeamCompliance(
      'org-1',
      'team-1',
      managerAccess,
    );

    expect(result.requirements[0]).toEqual(
      expect.objectContaining({ response: 'Coach Maria Santos' }),
    );
  });

  it('uses draft files for drafts and exact attempt files for submitted items', async () => {
    const listDraftFiles = jest.fn().mockResolvedValue([{ id: 'draft-file' }]);
    const listAttemptFiles = jest
      .fn()
      .mockResolvedValue([{ id: 'attempt-file' }]);
    const repository = createRepository({
      findSettingsByDivision: jest.fn().mockResolvedValue({
        ...settings,
        published_at: new Date('2026-08-11T00:00:00.000Z'),
        status: 'published',
      }),
      findProjection: jest.fn().mockResolvedValue({ status: 'pending' }),
      listDraftFiles,
      listAttemptFiles,
      listTeamSubmissions: jest.fn().mockResolvedValue([
        {
          ...required,
          current_attempt_id: null,
          requirement_id: 'requirement-draft',
          submission_id: 'submission-draft',
          workflow_status: 'draft',
        },
        {
          ...required,
          current_attempt_id: 'attempt-1',
          requirement_id: 'requirement-submitted',
          submission_id: 'submission-submitted',
          workflow_status: 'submitted',
        },
      ]),
    });
    const service = new ComplianceService(repository as never);

    const result = await service.findTeamCompliance(
      'org-1',
      'team-1',
      managerAccess,
    );

    expect(listDraftFiles).toHaveBeenCalledWith('submission-draft');
    expect(listAttemptFiles).toHaveBeenCalledWith(
      'submission-submitted',
      'attempt-1',
    );
    expect(result.requirements[0].files).toEqual([{ id: 'draft-file' }]);
    expect(result.requirements[1].files).toEqual([{ id: 'attempt-file' }]);
  });

  it('does not expose unpublished requirements to team managers', async () => {
    const repository = createRepository({
      findProjection: jest.fn().mockResolvedValue(null),
      listFilesForSubmission: jest.fn().mockResolvedValue([]),
    });
    const service = new ComplianceService(repository as never);

    await expect(
      service.findTeamCompliance('org-1', 'team-1', managerAccess),
    ).resolves.toEqual({
      clearance: { status: 'not_required' },
      requirements: [],
      settings: null,
      team: expect.objectContaining({ team_id: 'team-1' }),
    });
  });

  it('blocks game start until both teams are cleared after publication', async () => {
    const repository = createRepository({
      findSettingsByDivision: jest.fn().mockResolvedValue({
        ...settings,
        published_at: new Date('2026-08-11T00:00:00.000Z'),
        status: 'published',
      }),
      findProjection: jest
        .fn()
        .mockResolvedValueOnce({ status: 'cleared' })
        .mockResolvedValueOnce({ status: 'pending' }),
    });
    const service = new ComplianceService(repository as never);

    await expect(
      service.checkGameStartClearance({
        organizationId: 'org-1',
        divisionId: 'division-1',
        homeTeamId: 'team-1',
        homeTeamName: 'Blue Eagles',
        awayTeamId: 'team-2',
        awayTeamName: 'Red Lions',
      }),
    ).resolves.toEqual({
      allowed: false,
      blockedTeams: [{ name: 'Red Lions', status: 'pending' }],
    });
  });
});
