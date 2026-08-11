import { BadRequestException } from '@nestjs/common';

export const COMPLIANCE_RESPONSE_TYPES = [
  'file',
  'short_text',
  'long_text',
  'url',
  'acknowledgement',
] as const;

export type ComplianceResponseType = (typeof COMPLIANCE_RESPONSE_TYPES)[number];
export type ComplianceSettingsStatus = 'draft' | 'published' | 'archived';
export type ComplianceWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'waived'
  | 'reopened';
export type ComplianceReviewerAction =
  | 'approve'
  | 'request_changes'
  | 'waive'
  | 'reopen';

type ClearanceInput = {
  now: Date;
  requirements: Array<{ id: string; isRequired: boolean }>;
  settingsStatus: ComplianceSettingsStatus;
  submissions: Array<{
    requirementId: string;
    status: ComplianceWorkflowStatus;
    waiverExpiresAt: Date | null;
  }>;
};

export type TeamClearance = {
  blockingRequirementCount: number;
  pendingRequirementCount: number;
  status: 'not_required' | 'pending' | 'blocked' | 'cleared';
};

export function calculateTeamClearance(input: ClearanceInput): TeamClearance {
  if (input.settingsStatus !== 'published') {
    return {
      blockingRequirementCount: 0,
      pendingRequirementCount: 0,
      status: 'not_required',
    };
  }

  const submissions = new Map(
    input.submissions.map((submission) => [
      submission.requirementId,
      submission,
    ]),
  );
  let blockingRequirementCount = 0;
  let pendingRequirementCount = 0;

  for (const requirement of input.requirements) {
    if (!requirement.isRequired) {
      continue;
    }

    const submission = submissions.get(requirement.id);
    if (!submission) {
      pendingRequirementCount += 1;
      continue;
    }

    if (submission.status === 'approved') {
      continue;
    }

    if (submission.status === 'waived') {
      if (
        submission.waiverExpiresAt === null ||
        submission.waiverExpiresAt.getTime() > input.now.getTime()
      ) {
        continue;
      }
      blockingRequirementCount += 1;
      continue;
    }

    if (submission.status === 'rejected') {
      blockingRequirementCount += 1;
    } else {
      pendingRequirementCount += 1;
    }
  }

  return {
    blockingRequirementCount,
    pendingRequirementCount,
    status:
      blockingRequirementCount > 0
        ? 'blocked'
        : pendingRequirementCount > 0
          ? 'pending'
          : 'cleared',
  };
}

export function validateComplianceResponse(input: {
  isRequired: boolean;
  maxFileCount: number;
  response: unknown;
  responseType: ComplianceResponseType;
}): void {
  const missing =
    input.response === null ||
    input.response === undefined ||
    (typeof input.response === 'string' && input.response.trim().length === 0);

  if (missing) {
    if (input.isRequired) {
      throw new BadRequestException(
        'Add a response before submitting this requirement.',
      );
    }
    return;
  }

  if (input.responseType === 'acknowledgement') {
    if (input.response !== true) {
      throw new BadRequestException(
        'Confirm this requirement before submitting it.',
      );
    }
    return;
  }

  if (input.responseType === 'url') {
    if (typeof input.response !== 'string' || !isHttpUrl(input.response)) {
      throw new BadRequestException('Enter a complete http or https link.');
    }
    return;
  }

  if (
    input.responseType === 'short_text' ||
    input.responseType === 'long_text'
  ) {
    if (typeof input.response !== 'string') {
      throw new BadRequestException('Enter a text response.');
    }
    const limit = input.responseType === 'short_text' ? 500 : 5000;
    if (input.response.trim().length > limit) {
      throw new BadRequestException(
        `Keep this response within ${limit.toLocaleString()} characters.`,
      );
    }
    return;
  }

  if (!isFilePlaceholder(input.response)) {
    throw new BadRequestException('Select at least one uploaded file.');
  }

  if (input.response.files.length > input.maxFileCount) {
    throw new BadRequestException(
      `Upload no more than ${input.maxFileCount} ${input.maxFileCount === 1 ? 'file' : 'files'} for this requirement.`,
    );
  }
}

export function ensureSubmissionCanBeChanged(
  status: ComplianceWorkflowStatus,
): void {
  if (status === 'approved') {
    throw new BadRequestException(
      'This requirement is already approved. Ask a league administrator to reopen it before making changes.',
    );
  }
  if (status === 'submitted' || status === 'under_review') {
    throw new BadRequestException(
      'This requirement is waiting for review. Ask a league administrator to request changes before editing it.',
    );
  }
  if (status === 'waived') {
    throw new BadRequestException(
      'This requirement is waived. Ask a league administrator to reopen it before making changes.',
    );
  }
}

export function ensureReviewerActionAllowed(
  status: ComplianceWorkflowStatus,
  action: ComplianceReviewerAction,
): void {
  if (action === 'approve' || action === 'request_changes') {
    if (status !== 'submitted' && status !== 'under_review') {
      throw new BadRequestException(
        'This requirement is not ready for a review decision.',
      );
    }
    return;
  }

  if (action === 'reopen') {
    if (!['approved', 'rejected', 'waived'].includes(status)) {
      throw new BadRequestException('This requirement cannot be reopened yet.');
    }
    return;
  }

  if (status === 'approved') {
    throw new BadRequestException(
      'Reopen this approved requirement before waiving it.',
    );
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isFilePlaceholder(
  value: unknown,
): value is { files: Array<{ id: string }> } {
  if (typeof value !== 'object' || value === null || !('files' in value)) {
    return false;
  }
  const files = (value as { files?: unknown }).files;
  return (
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(
      (file) =>
        typeof file === 'object' &&
        file !== null &&
        'id' in file &&
        typeof (file as { id?: unknown }).id === 'string' &&
        (file as { id: string }).id.trim().length > 0,
    )
  );
}
