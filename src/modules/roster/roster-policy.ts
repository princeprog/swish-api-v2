import { BadRequestException } from '@nestjs/common';

export type RosterWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'returned'
  | 'approved';

export function ensureRosterCanBeEdited(status: RosterWorkflowStatus): void {
  if (status === 'submitted') {
    throw new BadRequestException(
      'This roster is waiting for review. Return it before changing players.',
    );
  }

  if (status === 'approved') {
    throw new BadRequestException(
      'This roster is already approved. Start an amendment before changing players.',
    );
  }
}

export function validateRosterSubmissionCount(input: {
  activePlayerCount: number;
  maxActivePlayers: number | null;
  minActivePlayers: number | null;
}): void {
  const minimum = input.minActivePlayers ?? 1;

  if (input.activePlayerCount < minimum) {
    throw new BadRequestException(
      minimum === 1
        ? 'Add at least one active player before submitting this roster.'
        : `This roster needs at least ${minimum} active players.`,
    );
  }

  if (
    input.maxActivePlayers !== null &&
    input.activePlayerCount > input.maxActivePlayers
  ) {
    throw new BadRequestException(
      `This roster can include up to ${input.maxActivePlayers} active players.`,
    );
  }
}

export function canExposeRosterPlayers(input: {
  hasPublishedVersion: boolean;
  isAssignedTeam: boolean;
  isReleased: boolean;
  isReviewer: boolean;
}): boolean {
  return (
    input.isReviewer ||
    input.isAssignedTeam ||
    (input.isReleased && input.hasPublishedVersion)
  );
}
