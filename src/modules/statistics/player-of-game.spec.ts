import { playerOfGameMetric, suggestPlayerOfGame } from './player-of-game';

const candidate = (overrides: Record<string, unknown>) => ({
  assists: 4,
  playerId: 'player-a',
  points: 20,
  rebounds: 8,
  steals: 2,
  teamId: 'team-a',
  turnovers: 3,
  ...overrides,
});

describe('Player of the Game suggestion', () => {
  it('uses points plus rebounds, assists, and steals minus turnovers', () => {
    expect(playerOfGameMetric(candidate({}))).toBe(31);
  });

  it('considers both teams and prefers the winner when the metric is tied', () => {
    const suggestion = suggestPlayerOfGame(
      [
        candidate({ playerId: 'losing-star', teamId: 'team-b' }),
        candidate({ playerId: 'winning-star', teamId: 'team-a' }),
      ],
      'team-a',
    );
    expect(suggestion).toEqual({
      metricScore: 31,
      playerId: 'winning-star',
      teamId: 'team-a',
    });
  });
});
