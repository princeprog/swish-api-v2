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
    expect(query.where).toHaveBeenCalledWith(
      'verification_status',
      'in',
      ['uploaded', 'scanning', 'verified', 'rejected'],
    );
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
    expect(query.where).toHaveBeenCalledWith(
      'verification_status',
      'in',
      ['uploaded', 'scanning', 'verified', 'rejected'],
    );
  });
});

function createQuery() {
  const query = {
    execute: jest.fn().mockResolvedValue([]),
    orderBy: jest.fn(),
    select: jest.fn(),
    where: jest.fn(),
  } as {
    execute: jest.Mock;
    orderBy: jest.Mock;
    select: jest.Mock;
    where: jest.Mock;
  };
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  return query;
}
