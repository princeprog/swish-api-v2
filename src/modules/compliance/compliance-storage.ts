import { Injectable } from '@nestjs/common';

export const COMPLIANCE_STORAGE = 'COMPLIANCE_STORAGE';

export interface ComplianceStorageBoundary {
  assertFileReferences(response: unknown): Promise<void>;
}

@Injectable()
export class PlaceholderComplianceStorage implements ComplianceStorageBoundary {
  async assertFileReferences(response: unknown): Promise<void> {
    // Task 3 replaces this provider with uploaded-file ownership and safety checks.
    void response;
    await Promise.resolve();
  }
}
