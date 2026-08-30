import {
  applyStatisticCommand,
  projectPlayerBoxScores,
  reconcilePlayerPoints,
  validateStatisticEvent,
} from './statistics-engine';

describe('statistics engine', () => {
  it('projects player totals without changing any official team score', () => {
    const boxScores = projectPlayerBoxScores([
      event('e1', 'home-player', 'home', 'points', 3),
      event('e2', 'home-player', 'home', 'rebound', 1),
      event('e3', 'home-player', 'home', 'assist', 1),
      event('e4', 'away-player', 'away', 'points', 2),
      event('e5', 'away-player', 'away', 'steal', 1),
      event('e6', 'away-player', 'away', 'turnover', 1),
    ]);

    expect(boxScores).toEqual([
      {
        assists: 1,
        playerId: 'home-player',
        points: 3,
        rebounds: 1,
        steals: 0,
        teamId: 'home',
        turnovers: 0,
      },
      {
        assists: 0,
        playerId: 'away-player',
        points: 2,
        rebounds: 0,
        steals: 1,
        teamId: 'away',
        turnovers: 1,
      },
    ]);
    expect(boxScores[0]).not.toHaveProperty('officialTeamScore');
  });

  it('removes a reversed event while preserving both audit records', () => {
    const original = event('e1', 'home-player', 'home', 'rebound', 1);
    const reversal = {
      ...event('e2', 'home-player', 'home', 'rebound', 1),
      reversesEventId: 'e1',
    };

    expect(projectPlayerBoxScores([original, reversal])).toEqual([
      expect.objectContaining({ playerId: 'home-player', rebounds: 0 }),
    ]);
  });

  it('reconciles summed player points with both official scores', () => {
    const boxScores = projectPlayerBoxScores([
      event('e1', 'home-player', 'home', 'points', 3),
      event('e2', 'away-player', 'away', 'points', 2),
    ]);

    expect(
      reconcilePlayerPoints(boxScores, {
        awayScore: 2,
        awayTeamId: 'away',
        homeScore: 3,
        homeTeamId: 'home',
      }),
    ).toEqual({
      awayPlayerPoints: 2,
      awayReconciled: true,
      homePlayerPoints: 3,
      homeReconciled: true,
      reconciled: true,
    });
    expect(
      reconcilePlayerPoints(boxScores, {
        awayScore: 3,
        awayTeamId: 'away',
        homeScore: 3,
        homeTeamId: 'home',
      }).reconciled,
    ).toBe(false);
  });

  it('limits point events to basketball scoring values', () => {
    expect(() =>
      validateStatisticEvent({ type: 'points', value: 4 }),
    ).toThrow('Player points must be 1, 2, or 3.');
    expect(() =>
      validateStatisticEvent({ type: 'assist', value: 2 }),
    ).toThrow('Non-scoring statistics must be recorded one at a time.');
  });

  it('applies commands with optimistic versions and idempotency', () => {
    const first = applyStatisticCommand(
      { events: [], version: 0 },
      {
        eventId: 'e1',
        expectedVersion: 0,
        idempotencyKey: 'command-1',
        playerId: 'home-player',
        teamId: 'home',
        type: 'points',
        value: 2,
      },
    );

    expect(first.version).toBe(1);
    expect(first.events[0]).toMatchObject({
      id: 'e1',
      idempotencyKey: 'command-1',
      sequence: 1,
    });
    expect(
      applyStatisticCommand(first, {
        eventId: 'different-id',
        expectedVersion: 0,
        idempotencyKey: 'command-1',
        playerId: 'home-player',
        teamId: 'home',
        type: 'points',
        value: 2,
      }),
    ).toEqual({ ...first, idempotent: true });
    expect(() =>
      applyStatisticCommand(first, {
        eventId: 'e2',
        expectedVersion: 0,
        idempotencyKey: 'command-2',
        playerId: 'home-player',
        teamId: 'home',
        type: 'rebound',
        value: 1,
      }),
    ).toThrow('Statistics changed on another device. Refresh before continuing.');
  });

  it('only reverses an active event once', () => {
    const initial = {
      events: [
        {
          ...event('e1', 'home-player', 'home', 'rebound', 1),
          idempotencyKey: 'command-1',
          sequence: 1,
        },
      ],
      version: 1,
    };
    const reversed = applyStatisticCommand(initial, {
      eventId: 'e2',
      expectedVersion: 1,
      idempotencyKey: 'command-2',
      reversesEventId: 'e1',
    });

    expect(reversed.boxScores[0]?.rebounds).toBe(0);
    expect(() =>
      applyStatisticCommand(reversed, {
        eventId: 'e3',
        expectedVersion: 2,
        idempotencyKey: 'command-3',
        reversesEventId: 'e1',
      }),
    ).toThrow('This statistic has already been reversed.');
  });
});

function event(
  id: string,
  playerId: string,
  teamId: string,
  type: 'points' | 'rebound' | 'assist' | 'steal' | 'turnover',
  value: number,
) {
  return { id, playerId, reversesEventId: null, teamId, type, value };
}
