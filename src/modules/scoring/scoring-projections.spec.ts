import {
  projectPeriodScores,
  projectPersonalFouls,
} from './scoring-projections';

describe('scoring projections', () => {
  it('builds period score breakdowns and removes reversed scores', () => {
    const events = [
      score('e1', 1, 0, 'home', 2),
      score('e2', 1, 0, 'away', 3),
      {
        ...score('e3', 1, 0, 'away', 3),
        reversesEventId: 'e2',
        type: 'event.reverse',
      },
      score('e4', 2, 0, 'home', 1),
    ];

    expect(projectPeriodScores(events, 'home', 'away')).toEqual([
      {
        awayScore: 0,
        homeScore: 2,
        overtimeNumber: 0,
        periodNumber: 1,
      },
      {
        awayScore: 0,
        homeScore: 1,
        overtimeNumber: 0,
        periodNumber: 2,
      },
    ]);
  });

  it('derives foul-out state from active player-attributed fouls', () => {
    const events = Array.from({ length: 5 }, (_, index) => ({
      id: `f${index + 1}`,
      overtimeNumber: 0,
      payload: { playerId: 'player-1', teamId: 'home' },
      periodNumber: 1,
      reversesEventId: null,
      type: 'personal_foul.record',
    }));

    expect(projectPersonalFouls(events, 5)).toEqual([
      {
        fouledOut: true,
        personalFouls: 5,
        playerId: 'player-1',
        teamId: 'home',
      },
    ]);
  });
});

function score(
  id: string,
  periodNumber: number,
  overtimeNumber: number,
  teamId: string,
  points: number,
) {
  return {
    id,
    overtimeNumber,
    payload: { points, teamId },
    periodNumber,
    reversesEventId: null as string | null,
    type: 'score.record',
  };
}
