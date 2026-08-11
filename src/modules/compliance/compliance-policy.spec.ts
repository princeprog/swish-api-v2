import { BadRequestException } from '@nestjs/common';
import {
  calculateTeamClearance,
  ensureReviewerActionAllowed,
  ensureSubmissionCanBeChanged,
  validateComplianceResponse,
} from './compliance-policy';

describe('compliance policy', () => {
  describe('response validation', () => {
    it.each([
      ['short_text', 'Barangay clearance'],
      ['long_text', 'A detailed explanation of the team submission.'],
      ['url', 'https://example.com/document'],
      ['acknowledgement', true],
      ['file', { files: [{ id: 'file-1' }] }],
    ] as const)('accepts a valid %s response', (responseType, response) => {
      expect(() =>
        validateComplianceResponse({
          isRequired: true,
          maxFileCount: 2,
          response,
          responseType,
        }),
      ).not.toThrow();
    });

    it('rejects a missing response for a required requirement', () => {
      expect(() =>
        validateComplianceResponse({
          isRequired: true,
          maxFileCount: 1,
          response: null,
          responseType: 'short_text',
        }),
      ).toThrow('Add a response before submitting this requirement.');
    });

    it('allows a missing response for an optional requirement', () => {
      expect(() =>
        validateComplianceResponse({
          isRequired: false,
          maxFileCount: 1,
          response: null,
          responseType: 'short_text',
        }),
      ).not.toThrow();
    });

    it('rejects file placeholders over the requirement limit', () => {
      expect(() =>
        validateComplianceResponse({
          isRequired: true,
          maxFileCount: 1,
          response: { files: [{ id: 'file-1' }, { id: 'file-2' }] },
          responseType: 'file',
        }),
      ).toThrow('Upload no more than 1 file for this requirement.');
    });
  });

  describe('clearance calculation', () => {
    const requirements = [
      { id: 'required-1', isRequired: true },
      { id: 'optional-1', isRequired: false },
    ];

    it.each(['draft', 'archived'] as const)(
      'does not require clearance while settings are %s',
      (settingsStatus) => {
        expect(
          calculateTeamClearance({
            now: new Date('2026-08-11T00:00:00.000Z'),
            requirements,
            settingsStatus,
            submissions: [],
          }),
        ).toEqual({
          blockingRequirementCount: 0,
          pendingRequirementCount: 0,
          status: 'not_required',
        });
      },
    );

    it('clears a published team when every active required item is approved', () => {
      expect(
        calculateTeamClearance({
          now: new Date('2026-08-11T00:00:00.000Z'),
          requirements,
          settingsStatus: 'published',
          submissions: [
            {
              requirementId: 'required-1',
              status: 'approved',
              waiverExpiresAt: null,
            },
          ],
        }),
      ).toEqual({
        blockingRequirementCount: 0,
        pendingRequirementCount: 0,
        status: 'cleared',
      });
    });

    it('treats an active waiver as satisfied and an expired waiver as blocked', () => {
      const active = calculateTeamClearance({
        now: new Date('2026-08-11T00:00:00.000Z'),
        requirements,
        settingsStatus: 'published',
        submissions: [
          {
            requirementId: 'required-1',
            status: 'waived',
            waiverExpiresAt: new Date('2026-08-12T00:00:00.000Z'),
          },
        ],
      });
      const expired = calculateTeamClearance({
        now: new Date('2026-08-11T00:00:00.000Z'),
        requirements,
        settingsStatus: 'published',
        submissions: [
          {
            requirementId: 'required-1',
            status: 'waived',
            waiverExpiresAt: new Date('2026-08-10T00:00:00.000Z'),
          },
        ],
      });

      expect(active.status).toBe('cleared');
      expect(expired).toEqual({
        blockingRequirementCount: 1,
        pendingRequirementCount: 0,
        status: 'blocked',
      });
    });

    it('blocks rejected items and leaves unresolved items pending', () => {
      expect(
        calculateTeamClearance({
          now: new Date('2026-08-11T00:00:00.000Z'),
          requirements: [
            { id: 'required-1', isRequired: true },
            { id: 'required-2', isRequired: true },
          ],
          settingsStatus: 'published',
          submissions: [
            {
              requirementId: 'required-1',
              status: 'rejected',
              waiverExpiresAt: null,
            },
            {
              requirementId: 'required-2',
              status: 'draft',
              waiverExpiresAt: null,
            },
          ],
        }),
      ).toEqual({
        blockingRequirementCount: 1,
        pendingRequirementCount: 1,
        status: 'blocked',
      });
    });

    it('revokes clearance when a new required item has no approved submission', () => {
      expect(
        calculateTeamClearance({
          now: new Date('2026-08-11T00:00:00.000Z'),
          requirements: [
            { id: 'required-1', isRequired: true },
            { id: 'new-required', isRequired: true },
          ],
          settingsStatus: 'published',
          submissions: [
            {
              requirementId: 'required-1',
              status: 'approved',
              waiverExpiresAt: null,
            },
          ],
        }).status,
      ).toBe('pending');
    });
  });

  describe('workflow transitions', () => {
    it('locks approved submissions from team changes', () => {
      expect(() => ensureSubmissionCanBeChanged('approved')).toThrow(
        'This requirement is already approved. Ask a league administrator to reopen it before making changes.',
      );
    });

    it.each(['submitted', 'under_review'] as const)(
      'allows approval from %s',
      (status) => {
        expect(() =>
          ensureReviewerActionAllowed(status, 'approve'),
        ).not.toThrow();
      },
    );

    it('requires reopen to start from a completed reviewer state', () => {
      expect(() => ensureReviewerActionAllowed('draft', 'reopen')).toThrow(
        BadRequestException,
      );
      expect(() =>
        ensureReviewerActionAllowed('approved', 'reopen'),
      ).not.toThrow();
    });
  });
});
