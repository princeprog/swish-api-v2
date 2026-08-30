import { findScheduleConflict } from './schedule-conflicts';

const proposed = {
  awayTeamId: 'team-b',
  homeTeamId: 'team-a',
  startsAt: new Date('2026-09-01T10:00:00.000Z'),
  venueId: 'venue-1',
};

describe('findScheduleConflict', () => {
  it('allows a game to start exactly when the previous slot ends', () => {
    expect(
      findScheduleConflict(proposed, 90, [
        {
          awayTeamId: 'team-c',
          homeTeamId: 'team-a',
          id: 'game-1',
          startsAt: new Date('2026-09-01T08:30:00.000Z'),
          venueId: 'venue-2',
        },
      ]),
    ).toBeNull();
  });

  it('rejects a team overlap one minute before the slot boundary', () => {
    expect(
      findScheduleConflict(proposed, 90, [
        {
          awayTeamId: 'team-c',
          homeTeamId: 'team-a',
          id: 'game-1',
          startsAt: new Date('2026-09-01T08:31:00.000Z'),
          venueId: 'venue-2',
        },
      ]),
    ).toMatchObject({ kind: 'team', resourceId: 'team-a' });
  });

  it('rejects a venue overlap even when both teams are available', () => {
    expect(
      findScheduleConflict(proposed, 90, [
        {
          awayTeamId: 'team-d',
          homeTeamId: 'team-c',
          id: 'game-1',
          startsAt: new Date('2026-09-01T10:30:00.000Z'),
          venueId: 'venue-1',
        },
      ]),
    ).toMatchObject({ kind: 'venue', resourceId: 'venue-1' });
  });

  it('ignores the game being rescheduled', () => {
    expect(
      findScheduleConflict(
        proposed,
        90,
        [
          {
            awayTeamId: 'team-b',
            homeTeamId: 'team-a',
            id: 'game-1',
            startsAt: new Date('2026-09-01T10:00:00.000Z'),
            venueId: 'venue-1',
          },
        ],
        'game-1',
      ),
    ).toBeNull();
  });

  it.each([
    ['scorekeeper', { scorekeeperMemberId: 'member-scorekeeper-1' }],
    ['statistician', { statisticianMemberId: 'member-statistician-1' }],
  ])('rejects an overlapping %s assignment', (kind, assignment) => {
    expect(
      findScheduleConflict({ ...proposed, ...assignment }, 90, [
        {
          ...proposed,
          awayTeamId: 'team-d',
          homeTeamId: 'team-c',
          id: 'game-1',
          startsAt: new Date('2026-09-01T10:30:00.000Z'),
          venueId: 'venue-2',
          ...assignment,
        },
      ]),
    ).toMatchObject({ kind });
  });

  it('rejects a one millisecond overlap for every shared resource', () => {
    const existing = {
      ...proposed,
      awayTeamId: 'team-d',
      homeTeamId: 'team-c',
      id: 'game-1',
      startsAt: new Date('2026-09-01T08:30:00.001Z'),
      venueId: 'venue-2',
      scorekeeperMemberId: 'member-scorekeeper-1',
      statisticianMemberId: 'member-statistician-1',
    };
    expect(
      findScheduleConflict(
        {
          ...proposed,
          scorekeeperMemberId: 'member-scorekeeper-1',
          statisticianMemberId: 'member-statistician-1',
        },
        90,
        [existing],
      ),
    ).toMatchObject({ kind: 'scorekeeper' });
    expect(
      findScheduleConflict({ ...proposed, venueId: 'venue-2' }, 90, [existing]),
    ).toMatchObject({ kind: 'venue' });
  });

  it.each([
    {
      kind: 'team',
      proposed: { homeTeamId: 'team-a' },
      existing: { homeTeamId: 'team-a' },
    },
    {
      kind: 'venue',
      proposed: { venueId: 'venue-1' },
      existing: { venueId: 'venue-1' },
    },
    {
      kind: 'scorekeeper',
      proposed: { scorekeeperMemberId: 'member-scorekeeper-1' },
      existing: { scorekeeperMemberId: 'member-scorekeeper-1' },
    },
    {
      kind: 'statistician',
      proposed: { statisticianMemberId: 'member-statistician-1' },
      existing: { statisticianMemberId: 'member-statistician-1' },
    },
  ])('$kind permits exact boundary and rejects a 1ms overlap', ({
    kind,
    proposed: proposedResource,
    existing: existingResource,
  }) => {
    const proposedSlot = {
      ...proposed,
      awayTeamId: 'team-b',
      homeTeamId: 'team-a',
      venueId: 'venue-1',
      ...proposedResource,
    };
    const existingSlot = {
      ...proposed,
      awayTeamId: 'team-d',
      homeTeamId: 'team-c',
      venueId: 'venue-2',
      id: 'game-1',
      startsAt: new Date('2026-09-01T08:30:00.000Z'),
      ...existingResource,
    };
    expect(findScheduleConflict(proposedSlot, 90, [existingSlot])).toBeNull();
    expect(
      findScheduleConflict(
        proposedSlot,
        90,
        [{
          ...existingSlot,
          startsAt: new Date('2026-09-01T08:30:00.001Z'),
        }],
      ),
    ).toMatchObject({ kind });
  });
});
