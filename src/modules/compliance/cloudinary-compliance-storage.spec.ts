import { BadRequestException } from '@nestjs/common';
import { CloudinaryComplianceStorage } from './cloudinary-compliance-storage';

describe('CloudinaryComplianceStorage', () => {
  const previous = {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  };

  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
  });

  afterAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = previous.cloudName;
    process.env.CLOUDINARY_API_KEY = previous.apiKey;
    process.env.CLOUDINARY_API_SECRET = previous.apiSecret;
  });

  it('creates a signed authenticated upload and persists a pending file', async () => {
    const repository = {
      createPendingFile: jest.fn().mockResolvedValue({}),
    };
    const client = fakeClient();
    const storage = new CloudinaryComplianceStorage(repository, client);

    const result = await storage.prepareUpload({
      byteSize: 1024,
      fileOrder: 1,
      mimeType: 'application/pdf',
      organizationId: 'org-1',
      originalFilename: 'permit.pdf',
      requirementId: 'requirement-1',
      sha256: 'a'.repeat(64),
      submissionId: 'submission-1',
      teamId: 'team-1',
    });

    expect(result.uploadUrl).toContain('/test-cloud/raw/upload');
    expect(result.fields.type).toBe('authenticated');
    expect(result.fields.resource_type).toBe('raw');
    expect(result.fields.signature).toBe('signed');
    expect(repository.createPendingFile).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_provider: 'cloudinary',
        submission_id: 'submission-1',
        verification_status: 'pending_upload',
      }),
    );
  });

  it('verifies the private asset metadata before allowing submission', async () => {
    const repository = {
      findFile: jest.fn().mockResolvedValue(fileRecord()),
      updateFile: jest.fn().mockResolvedValue({}),
      createFileScanJob: jest.fn().mockResolvedValue({}),
    };
    const client = fakeClient();
    client.api.resource = jest.fn().mockResolvedValue({
      bytes: 1024,
      resource_type: 'raw',
      type: 'authenticated',
    });
    const storage = new CloudinaryComplianceStorage(repository, client);

    await expect(
      storage.completeUpload({
        fileId: 'file-1',
        organizationId: 'org-1',
        requirementId: 'requirement-1',
        submissionId: 'submission-1',
        teamId: 'team-1',
      }),
    ).resolves.toEqual({ fileId: 'file-1', verificationStatus: 'verified' });
    expect(repository.updateFile).toHaveBeenCalledWith(
      'file-1',
      expect.objectContaining({ verification_status: 'verified' }),
    );
    expect(repository.createFileScanJob).toHaveBeenCalled();
  });

  it('rejects a response that references a file outside the submission', async () => {
    const repository = {
      listFiles: jest.fn().mockResolvedValue([]),
    };
    const storage = new CloudinaryComplianceStorage(repository, fakeClient());

    await expect(
      storage.assertFileReferences(
        { files: [{ id: 'file-1' }] },
        {
          organizationId: 'org-1',
          requirementId: 'requirement-1',
          submissionId: 'submission-1',
          teamId: 'team-1',
        },
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

function fakeClient() {
  return {
    config: jest.fn(),
    api: { resource: jest.fn() },
    uploader: { destroy: jest.fn() },
    utils: { api_sign_request: jest.fn().mockReturnValue('signed') },
    url: jest.fn().mockReturnValue('https://signed.example/file'),
  };
}

function fileRecord() {
  return {
    id: 'file-1',
    storage_key: 'swish/compliance/org-1/team-1/requirement-1/file-1',
    storage_provider: 'cloudinary',
    original_filename: 'permit.pdf',
    mime_type: 'application/pdf',
    byte_size: 1024,
    sha256: 'a'.repeat(64),
    verification_status: 'pending_upload',
    submission_id: 'submission-1',
    submission_attempt_id: null,
    organization_id: 'org-1',
    team_id: 'team-1',
    requirement_id: 'requirement-1',
  };
}
