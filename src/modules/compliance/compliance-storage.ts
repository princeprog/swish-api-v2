import { Injectable } from '@nestjs/common';

export const COMPLIANCE_STORAGE = 'COMPLIANCE_STORAGE';

export type ComplianceUploadContext = {
  organizationId: string;
  teamId: string;
  requirementId: string;
  submissionId: string;
};

export type PrepareComplianceUploadInput = ComplianceUploadContext & {
  fileOrder: number;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
};

export type PreparedComplianceUpload = {
  fileId: string;
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: Date;
};

export type CompleteComplianceUploadInput = ComplianceUploadContext & {
  fileId: string;
};

export type ComplianceDownloadContext = {
  organizationId: string;
  teamId: string;
};

export interface ComplianceStorageBoundary {
  prepareUpload(
    input: PrepareComplianceUploadInput,
  ): Promise<PreparedComplianceUpload>;
  completeUpload(
    input: CompleteComplianceUploadInput,
  ): Promise<{ fileId: string; verificationStatus: string }>;
  assertFileReferences(
    response: unknown,
    context: ComplianceUploadContext,
  ): Promise<void>;
  attachFilesToAttempt(
    response: unknown,
    submissionId: string,
    attemptId: string,
  ): Promise<void>;
  deleteUpload(input: CompleteComplianceUploadInput): Promise<void>;
  createDownloadUrl(
    fileId: string,
    context: ComplianceDownloadContext,
  ): Promise<{ url: string; expiresAt: Date }>;
}

@Injectable()
export class PlaceholderComplianceStorage implements ComplianceStorageBoundary {
  prepareUpload(): Promise<PreparedComplianceUpload> {
    return Promise.reject(new Error('Compliance storage is not configured.'));
  }

  completeUpload(): Promise<{
    fileId: string;
    verificationStatus: string;
  }> {
    return Promise.reject(new Error('Compliance storage is not configured.'));
  }

  assertFileReferences(): Promise<void> {
    return Promise.resolve();
  }

  attachFilesToAttempt(): Promise<void> {
    return Promise.resolve();
  }

  deleteUpload(): Promise<void> {
    return Promise.reject(new Error('Compliance storage is not configured.'));
  }

  createDownloadUrl(): Promise<{ url: string; expiresAt: Date }> {
    return Promise.reject(new Error('Compliance storage is not configured.'));
  }
}
