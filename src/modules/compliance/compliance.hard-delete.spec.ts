import { ComplianceService } from './compliance.service';

describe('ComplianceService hard-delete barrier', () => {
  it('rejects upload deletion until submission-file archival exists', async () => {
    const service = new ComplianceService({} as never);

    await expect(
      service.deleteUpload(
        'org-1',
        'team-1',
        'requirement-1',
        {} as never,
        'file-1',
      ),
    ).rejects.toThrow(
      'Uploaded files cannot be deleted yet. Keep the file in the submission or ask a league administrator to archive it.',
    );
  });
});
