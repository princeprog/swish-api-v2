import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { ComplianceRepository } from './compliance.repository';
import {
  type CompleteComplianceUploadInput,
  type ComplianceDownloadContext,
  type ComplianceStorageBoundary,
  type ComplianceUploadContext,
  type PrepareComplianceUploadInput,
  type PreparedComplianceUpload,
} from './compliance-storage';

export const CLOUDINARY_CLIENT = 'CLOUDINARY_CLIENT';

type CloudinaryClient = {
  config: (options: Record<string, string | boolean>) => void;
  api: {
    resource: (
      publicId: string,
      options: Record<string, string>,
    ) => Promise<Record<string, unknown>>;
  };
  uploader: {
    destroy: (
      publicId: string,
      options: Record<string, string | boolean>,
    ) => Promise<Record<string, unknown>>;
  };
  utils: {
    api_sign_request: (
      params: Record<string, string | number>,
      secret: string,
    ) => string;
    private_download_url: (
      publicId: string,
      format: string,
      options: Record<string, string | number | boolean>,
    ) => string;
  };
};

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);
const RAW_FILE_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 15 * 60;
const DOWNLOAD_TTL_SECONDS = 5 * 60;

@Injectable()
export class CloudinaryComplianceStorage implements ComplianceStorageBoundary {
  private readonly client: CloudinaryClient;
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly folder: string;

  constructor(
    private readonly repository: ComplianceRepository,
    @Inject(CLOUDINARY_CLIENT)
    client: CloudinaryClient = cloudinary,
  ) {
    this.client = client;
    this.cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? '';
    this.apiKey = process.env.CLOUDINARY_API_KEY ?? '';
    this.apiSecret = process.env.CLOUDINARY_API_SECRET ?? '';
    this.folder =
      process.env.CLOUDINARY_COMPLIANCE_FOLDER ?? 'swish/compliance';

    if (this.cloudName && this.apiKey && this.apiSecret) {
      this.client.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      });
    }
  }

  async prepareUpload(
    input: PrepareComplianceUploadInput,
  ): Promise<PreparedComplianceUpload> {
    this.assertConfigured();
    this.validateFile(input);

    const fileId = randomUUID();
    const fileExtension = RAW_FILE_EXTENSIONS[input.mimeType];
    const storageKey =
      [
        this.folder,
        input.organizationId,
        input.teamId,
        input.requirementId,
        fileId,
      ].join('/') + `.${fileExtension}`;
    const now = new Date();

    await this.repository.createPendingFile({
      byte_size: input.byteSize,
      file_order: input.fileOrder,
      id: fileId,
      mime_type: input.mimeType,
      original_filename: input.originalFilename.trim(),
      sha256: input.sha256.toLowerCase(),
      storage_key: storageKey,
      storage_provider: 'cloudinary',
      submission_attempt_id: null,
      submission_id: input.submissionId,
      updated_at: now,
      verification_status: 'pending_upload',
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
      context: `sha256=${input.sha256.toLowerCase()}`,
      public_id: storageKey,
      timestamp,
      type: 'authenticated',
    };
    const expiresAt = new Date((timestamp + UPLOAD_TTL_SECONDS) * 1000);

    return {
      fileId,
      uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(this.cloudName)}/raw/upload`,
      fields: {
        api_key: this.apiKey,
        context: params.context,
        public_id: params.public_id,
        resource_type: 'raw',
        signature: this.client.utils.api_sign_request(params, this.apiSecret),
        timestamp: String(params.timestamp),
        type: params.type,
      },
      expiresAt,
    };
  }

  async completeUpload(
    input: CompleteComplianceUploadInput,
  ): Promise<{ fileId: string; verificationStatus: string }> {
    this.assertConfigured();
    const file = await this.repository.findFile(input.fileId);
    this.assertFileOwnership(file, input);

    if (file.verification_status === 'verified') {
      return {
        fileId: file.id,
        verificationStatus: file.verification_status,
      };
    }

    try {
      const resource = await this.client.api.resource(file.storage_key, {
        resource_type: 'raw',
        type: 'authenticated',
      });
      const bytes = Number(resource.bytes ?? 0);
      const resourceType =
        typeof resource.resource_type === 'string'
          ? resource.resource_type
          : '';
      const resourceTypeKind =
        typeof resource.type === 'string' ? resource.type : '';

      if (
        bytes !== file.byte_size ||
        resourceType !== 'raw' ||
        resourceTypeKind !== 'authenticated'
      ) {
        await this.repository.updateFile(file.id, {
          rejection_reason:
            'The uploaded file did not match its upload details.',
          updated_at: new Date(),
          verification_status: 'rejected',
        });
        throw new BadRequestException(
          'The uploaded file could not be verified. Please upload it again.',
        );
      }

      const now = new Date();
      await this.repository.updateFile(file.id, {
        rejection_reason: null,
        updated_at: now,
        uploaded_at: now,
        verification_status: 'verified',
        verified_at: now,
      });
      await this.repository.createFileScanJob(file.id, 'cloudinary_metadata', {
        checks: ['private_asset', 'content_type', 'file_size'],
        verifiedAt: now.toISOString(),
      });

      return { fileId: file.id, verificationStatus: 'verified' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      await this.repository.updateFile(file.id, {
        rejection_reason: 'Cloudinary did not return the uploaded file.',
        updated_at: new Date(),
        verification_status: 'rejected',
      });
      throw new BadRequestException(
        'The uploaded file could not be verified. Please upload it again.',
      );
    }
  }

  async assertFileReferences(
    response: unknown,
    context: ComplianceUploadContext,
  ): Promise<void> {
    const fileIds = readFileIds(response);
    if (fileIds.length === 0) {
      throw new BadRequestException('Select at least one uploaded file.');
    }
    const files = await this.repository.listFiles(
      fileIds,
      context.submissionId,
    );
    if (
      files.length !== fileIds.length ||
      files.some((file) => file.verification_status !== 'verified')
    ) {
      throw new BadRequestException(
        'Wait for each file to finish checking before submitting this requirement.',
      );
    }
  }

  async attachFilesToAttempt(
    response: unknown,
    submissionId: string,
    attemptId: string,
  ): Promise<void> {
    const fileIds = readFileIds(response);
    if (fileIds.length === 0) return;
    const files = await this.repository.listFiles(fileIds, submissionId);
    if (
      files.length !== fileIds.length ||
      files.some((file) => file.verification_status !== 'verified')
    ) {
      throw new BadRequestException(
        'Each file must finish checking before the requirement is submitted.',
      );
    }
    await this.repository.attachFilesToAttempt(
      fileIds,
      submissionId,
      attemptId,
    );
  }

  async deleteUpload(input: CompleteComplianceUploadInput): Promise<void> {
    this.assertConfigured();
    const file = await this.repository.findFile(input.fileId);
    this.assertFileOwnership(file, input);
    if (file.submission_attempt_id) {
      throw new BadRequestException(
        'Submitted evidence is part of the review history and cannot be deleted.',
      );
    }
    await this.client.uploader.destroy(file.storage_key, {
      invalidate: true,
      resource_type: 'raw',
      type: 'authenticated',
    });
    await this.repository.deleteFile(file.id, input.submissionId);
  }

  async createDownloadUrl(
    fileId: string,
    context: ComplianceDownloadContext,
  ): Promise<{ url: string; expiresAt: Date }> {
    this.assertConfigured();
    const file = await this.repository.findFile(fileId);
    if (
      !file ||
      file.organization_id !== context.organizationId ||
      file.team_id !== context.teamId
    ) {
      throw new NotFoundException('Evidence file not found.');
    }
    if (file.verification_status !== 'verified') {
      throw new BadRequestException(
        'This file is not ready to view yet. Check back after the file finishes checking.',
      );
    }

    const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000);
    const url = this.client.utils.private_download_url(file.storage_key, '', {
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      resource_type: 'raw',
      type: 'authenticated',
    });
    return { url, expiresAt };
  }

  private assertConfigured(): void {
    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new ServiceUnavailableException(
        'Evidence uploads are not configured yet. Please contact the league organizer.',
      );
    }
  }

  private validateFile(input: PrepareComplianceUploadInput): void {
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException('Upload a PDF, JPG, or PNG file.');
    }
    if (
      !Number.isInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > MAX_FILE_SIZE
    ) {
      throw new BadRequestException('Each file must be 10 MB or smaller.');
    }
    if (
      !Number.isInteger(input.fileOrder) ||
      input.fileOrder < 1 ||
      input.fileOrder > 5
    ) {
      throw new BadRequestException('Choose a valid file position.');
    }
    if (!/^[a-f0-9]{64}$/i.test(input.sha256)) {
      throw new BadRequestException(
        'The file could not be prepared for upload.',
      );
    }
    if (!input.originalFilename.trim()) {
      throw new BadRequestException('Add a file name before uploading.');
    }
  }

  private assertFileOwnership(
    file: Awaited<ReturnType<ComplianceRepository['findFile']>>,
    context: ComplianceUploadContext,
  ): asserts file is NonNullable<typeof file> {
    if (
      !file ||
      file.organization_id !== context.organizationId ||
      file.team_id !== context.teamId ||
      file.requirement_id !== context.requirementId ||
      file.submission_id !== context.submissionId
    ) {
      throw new NotFoundException('Evidence file not found.');
    }
  }
}

function readFileIds(response: unknown): string[] {
  if (
    typeof response !== 'object' ||
    response === null ||
    !('files' in response)
  ) {
    return [];
  }
  const files = (response as { files?: unknown }).files;
  if (!Array.isArray(files)) return [];
  const ids = files
    .map((file) =>
      typeof file === 'object' && file !== null && 'id' in file
        ? (file as { id?: unknown }).id
        : null,
    )
    .filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0,
    );
  return Array.from(new Set(ids));
}
