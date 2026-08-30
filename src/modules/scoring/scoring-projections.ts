export type ScoringProjectionEvent = {
  id: string;
  overtimeNumber: number;
  payload: Record<string, unknown>;
  periodNumber: number;
  reversesEventId: string | null;
  type: string;
};

function activeEvents(events: ScoringProjectionEvent[]) {
  const reversedIds = new Set(
    events.flatMap((event) =>
      event.reversesEventId ? [event.reversesEventId] : [],
    ),
  );
  return events.filter(
    (event) => !event.reversesEventId && !reversedIds.has(event.id),
  );
}

export function projectPeriodScores(
  events: ScoringProjectionEvent[],
  homeTeamId: string,
  awayTeamId: string,
) {
  const periods = new Map<
    string,
    {
      awayScore: number;
      homeScore: number;
      overtimeNumber: number;
      periodNumber: number;
    }
  >();

  for (const event of activeEvents(events)) {
    if (event.type !== 'score.record') continue;
    const points = event.payload.points;
    const teamId = event.payload.teamId;
    if (typeof points !== 'number' || typeof teamId !== 'string') continue;
    const key = `${event.periodNumber}:${event.overtimeNumber}`;
    const period = periods.get(key) ?? {
      awayScore: 0,
      homeScore: 0,
      overtimeNumber: event.overtimeNumber,
      periodNumber: event.periodNumber,
    };
    if (teamId === homeTeamId) period.homeScore += points;
    if (teamId === awayTeamId) period.awayScore += points;
    periods.set(key, period);
  }

  return [...periods.values()].sort(
    (left, right) =>
      left.periodNumber - right.periodNumber ||
      left.overtimeNumber - right.overtimeNumber,
  );
}

export function projectPersonalFouls(
  events: ScoringProjectionEvent[],
  personalFoulLimit: number,
) {
  const totals = new Map<
    string,
    {
      fouledOut: boolean;
      personalFouls: number;
      playerId: string;
      teamId: string;
    }
  >();

  for (const event of activeEvents(events)) {
    if (event.type !== 'personal_foul.record') continue;
    const playerId = event.payload.playerId;
    const teamId = event.payload.teamId;
    if (typeof playerId !== 'string' || typeof teamId !== 'string') continue;
    const total = totals.get(playerId) ?? {
      fouledOut: false,
      personalFouls: 0,
      playerId,
      teamId,
    };
    total.personalFouls += 1;
    total.fouledOut = total.personalFouls >= personalFoulLimit;
    totals.set(playerId, total);
  }

  return [...totals.values()];
}
