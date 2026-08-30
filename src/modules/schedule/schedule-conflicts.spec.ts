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
      findScheduleConflict(proposed, 90, [
        {
          awayTeamId: 'team-b',
          homeTeamId: 'team-a',
          id: 'game-1',
          startsAt: new Date('2026-09-01T10:00:00.000Z'),
          venueId: 'venue-1',
        },
      ], 'game-1'),
    ).toBeNull();
  });
});
