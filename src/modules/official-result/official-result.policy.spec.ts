import {
  assertOfficialResultScore,
  assertStatisticsGate,
  orderDownstreamMatchupsForReopen,
  planMatchupProgression,
} from './official-result.policy';

describe('official result policy', () => {
  it('requires a winning basketball score', () => {
    expect(() => assertOfficialResultScore(80, 80)).toThrow(
      'Basketball games need a winning team before they can be finalized.',
    );
  });

  it('requires an assigned stat sheet to reconcile with both official scores', () => {
    expect(() =>
      assertStatisticsGate(
        {
          awayPlayerPoints: 78,
          homePlayerPoints: 82,
          overrideReason: null,
          status: 'submitted',
        },
        { awayScore: 79, homeScore: 82 },
        true,
      ),
    ).toThrow('Player statistics must match both official team scores');

    expect(() =>
      assertStatisticsGate(
        {
          awayPlayerPoints: 78,
          homePlayerPoints: 82,
          overrideReason: 'One basket was credited as a team score.',
          status: 'submitted',
        },
        { awayScore: 79, homeScore: 82 },
        true,
      ),
    ).not.toThrow();
  });

  it('advances winners and losers into their configured bracket slots', () => {
    const updates = planMatchupProgression(
      {
        awayTeamId: 'team-b',
        bracketSide: 'winners',
        homeTeamId: 'team-a',
        id: 'match-1',
        isResetFinal: false,
        loserToMatchupId: 'loser-next',
        loserToSlot: 'home',
        winnerToMatchupId: 'winner-next',
        winnerToSlot: 'away',
      },
      'team-a',
      'team-b',
    );

    expect(updates).toEqual(
      expect.objectContaining({
        championTeamId: null,
        eliminatedTeamIds: [],
        targetSlots: [
          { matchupId: 'winner-next', slot: 'away', teamId: 'team-a' },
          { matchupId: 'loser-next', slot: 'home', teamId: 'team-b' },
        ],
      }),
    );
  });

  it('skips a reset final when the winners-bracket team wins the grand final', () => {
    const updates = planMatchupProgression(
      {
        awayTeamId: 'losers-champion',
        bracketSide: 'finals',
        homeTeamId: 'winners-champion',
        id: 'grand-final',
        isResetFinal: false,
        loserToMatchupId: 'reset-final',
        loserToSlot: 'away',
        winnerToMatchupId: 'reset-final',
        winnerToSlot: 'home',
      },
      'winners-champion',
      'losers-champion',
    );

    expect(updates).toEqual({
      championTeamId: 'winners-champion',
      eliminatedTeamIds: ['losers-champion'],
      targetSlots: [],
      voidMatchupIds: ['reset-final'],
    });
  });

  it('orders dependent matchups from the deepest game back to the source', () => {
    expect(
      orderDownstreamMatchupsForReopen(
        [
          {
            id: 'semifinal',
            loserToMatchupId: null,
            winnerToMatchupId: 'final',
          },
          {
            id: 'final',
            loserToMatchupId: 'reset-final',
            winnerToMatchupId: 'reset-final',
          },
          {
            id: 'reset-final',
            loserToMatchupId: null,
            winnerToMatchupId: null,
          },
        ],
        'semifinal',
      ),
    ).toEqual(['reset-final', 'final']);
  });

  it('deduplicates converging winner and loser dependencies', () => {
    expect(
      orderDownstreamMatchupsForReopen(
        [
          {
            id: 'grand-final',
            loserToMatchupId: 'reset-final',
            winnerToMatchupId: 'reset-final',
          },
          {
            id: 'reset-final',
            loserToMatchupId: null,
            winnerToMatchupId: null,
          },
        ],
        'grand-final',
      ),
    ).toEqual(['reset-final']);
  });
});
