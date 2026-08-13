import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ComplianceRepository } from './compliance.repository';

const repositorySource = readFileSync(
  resolve(__dirname, 'compliance.repository.ts'),
  'utf8',
);

describe('ComplianceRepository', () => {
  it('qualifies the projection version when incrementing an existing row', () => {
    expect(repositorySource).toMatch(
      /version:\s*eb\(\s*eb\.ref\(['"]compliance\.team_clearance_projections\.version['"]\),\s*['"]\+['"],\s*1,?\s*\)/,
    );
  });

  it('lists only visible draft files for a submission', async () => {
    const query = createQuery();
    const repository = new ComplianceRepository({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await repository.listDraftFiles('submission-1');

    expect(query.where).toHaveBeenCalledWith(
      'submission_attempt_id',
      'is',
      null,
    );
    expect(query.where).toHaveBeenCalledWith('verification_status', 'in', [
      'uploaded',
      'scanning',
      'verified',
      'rejected',
    ]);
  });

  it('lists only visible files attached to the requested attempt', async () => {
    const query = createQuery();
    const repository = new ComplianceRepository({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await repository.listAttemptFiles('submission-1', 'attempt-2');

    expect(query.where).toHaveBeenCalledWith(
      'submission_attempt_id',
      '=',
      'attempt-2',
    );
    expect(query.where).toHaveBeenCalledWith('verification_status', 'in', [
      'uploaded',
      'scanning',
      'verified',
      'rejected',
    ]);
  });

  it('counts submissions awaiting reviewer action within a division', async () => {
    const query = createQuery();
    query.executeTakeFirstOrThrow.mockResolvedValue({ count: '4' });
    const repository = new ComplianceRepository({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await expect(repository.countReviewSubmissions('division-1')).resolves.toBe(
      4,
    );

    expect(query.where).toHaveBeenCalledWith(
      'submissions.workflow_status',
      'in',
      ['submitted', 'under_review'],
    );
  });

  it('scopes a review submission lookup to the organization', async () => {
    const query = createQuery();
    const repository = new ComplianceRepository({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await repository.findReviewSubmission('org-1', 'submission-1');

    expect(query.where).toHaveBeenCalledWith(
      'submissions.id',
      '=',
      'submission-1',
    );
    expect(query.where).toHaveBeenCalledWith(
      'seasons.organization_id',
      '=',
      'org-1',
    );
  });

  it('includes the division id in the review detail projection', async () => {
    const query = createQuery();
    const repository = new ComplianceRepository({
      selectFrom: jest.fn().mockReturnValue(query),
    } as never);

    await repository.findReviewSubmission('org-1', 'submission-1');

    expect(query.select).toHaveBeenCalledWith(
      expect.arrayContaining(['divisions.id as division_id']),
    );
  });
});

function createQuery() {
  const query = {
    execute: jest.fn().mockResolvedValue([]),
    executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ count: '0' }),
    innerJoin: jest.fn(),
    orderBy: jest.fn(),
    select: jest.fn(),
    where: jest.fn(),
  };
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  return query;
}
