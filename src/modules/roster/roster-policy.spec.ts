import {
  canExposeRosterPlayers,
  ensureRosterCanBeEdited,
  validateRosterSubmissionCount,
} from './roster-policy';

describe('roster policy', () => {
  it('allows editing draft and returned rosters only', () => {
    expect(() => ensureRosterCanBeEdited('draft')).not.toThrow();
    expect(() => ensureRosterCanBeEdited('returned')).not.toThrow();
    expect(() => ensureRosterCanBeEdited('submitted')).toThrow(
      'This roster is waiting for review. Return it before changing players.',
    );
    expect(() => ensureRosterCanBeEdited('approved')).toThrow(
      'This roster is already approved. Start an amendment before changing players.',
    );
  });

  it('validates active player count against configured limits', () => {
    expect(() =>
      validateRosterSubmissionCount({
        activePlayerCount: 0,
        maxActivePlayers: null,
        minActivePlayers: null,
      }),
    ).toThrow('Add at least one active player before submitting this roster.');

    expect(() =>
      validateRosterSubmissionCount({
        activePlayerCount: 7,
        maxActivePlayers: 6,
        minActivePlayers: 5,
      }),
    ).toThrow('This roster can include up to 6 active players.');

    expect(() =>
      validateRosterSubmissionCount({
        activePlayerCount: 4,
        maxActivePlayers: 12,
        minActivePlayers: 5,
      }),
    ).toThrow('This roster needs at least 5 active players.');
  });

  it('hides unassigned roster players before release', () => {
    expect(
      canExposeRosterPlayers({
        isAssignedTeam: false,
        isReviewer: false,
        isReleased: false,
        hasPublishedVersion: true,
      }),
    ).toBe(false);

    expect(
      canExposeRosterPlayers({
        isAssignedTeam: false,
        isReviewer: false,
        isReleased: true,
        hasPublishedVersion: true,
      }),
    ).toBe(true);
  });
});
