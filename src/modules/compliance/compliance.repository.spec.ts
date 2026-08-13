import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositorySource = readFileSync(
  resolve(__dirname, 'compliance.repository.ts'),
  'utf8',
);

describe('ComplianceRepository', () => {
  it('qualifies the projection version when incrementing an existing row', () => {
    expect(repositorySource).toMatch(
      /version:\s*eb\(\s*eb\.ref\(['"]compliance\.team_clearance_projections\.version['"]\),\s*['"]\+['"],\s*1\s*\)/,
    );
  });
});
