import { resolveRosterDeadlineEvent } from './roster.service';

describe('resolveRosterDeadlineEvent', () => {
  it('identifies a newly configured deadline', () => {
    expect(
      resolveRosterDeadlineEvent(null, new Date('2026-08-20T00:00:00.000Z')),
    ).toBe('roster.deadline_set');
  });

  it('identifies a changed deadline', () => {
    expect(
      resolveRosterDeadlineEvent(
        new Date('2026-08-20T00:00:00.000Z'),
        new Date('2026-08-21T00:00:00.000Z'),
      ),
    ).toBe('roster.deadline_changed');
  });

  it('does not create an event when a deadline is removed or unchanged', () => {
    expect(resolveRosterDeadlineEvent(null, null)).toBeNull();
    expect(
      resolveRosterDeadlineEvent(
        new Date('2026-08-20T00:00:00.000Z'),
        null,
      ),
    ).toBeNull();
    expect(
      resolveRosterDeadlineEvent(
        new Date('2026-08-20T00:00:00.000Z'),
        new Date('2026-08-20T00:00:00.000Z'),
      ),
    ).toBeNull();
  });
});
