export type StatisticEventType =
  | 'points'
  | 'rebound'
  | 'assist'
  | 'steal'
  | 'turnover';

export type StatisticProjectionEvent = {
  id: string;
  playerId: string;
  reversesEventId: string | null;
  teamId: string;
  type: StatisticEventType;
  value: number;
};

export type PlayerBoxScore = {
  assists: number;
  playerId: string;
  points: number;
  rebounds: number;
  steals: number;
  teamId: string;
  turnovers: number;
};

export type StatisticRecordedEvent = StatisticProjectionEvent & {
  idempotencyKey: string;
  sequence: number;
};

export type StatisticCommand = {
  eventId: string;
  expectedVersion: number;
  idempotencyKey: string;
  playerId?: string;
  reversesEventId?: string;
  teamId?: string;
  type?: StatisticEventType;
  value?: number;
};

export function validateStatisticEvent(input: {
  type: StatisticEventType;
  value: number;
}): void {
  if (input.type === 'points') {
    if (![1, 2, 3].includes(input.value)) {
      throw new Error('Player points must be 1, 2, or 3.');
    }
    return;
  }

  if (input.value !== 1) {
    throw new Error('Non-scoring statistics must be recorded one at a time.');
  }
}

export function projectPlayerBoxScores(
  events: StatisticProjectionEvent[],
): PlayerBoxScore[] {
  const reversedEventIds = new Set(
    events.flatMap((event) =>
      event.reversesEventId ? [event.reversesEventId] : [],
    ),
  );
  const projections = new Map<string, PlayerBoxScore>();

  for (const event of events) {
    const projection = projections.get(event.playerId) ?? {
      assists: 0,
      playerId: event.playerId,
      points: 0,
      rebounds: 0,
      steals: 0,
      teamId: event.teamId,
      turnovers: 0,
    };
    projections.set(event.playerId, projection);

    if (event.reversesEventId || reversedEventIds.has(event.id)) continue;

    if (event.type === 'points') projection.points += event.value;
    if (event.type === 'rebound') projection.rebounds += event.value;
    if (event.type === 'assist') projection.assists += event.value;
    if (event.type === 'steal') projection.steals += event.value;
    if (event.type === 'turnover') projection.turnovers += event.value;
  }

  return [...projections.values()];
}

export function reconcilePlayerPoints(
  boxScores: PlayerBoxScore[],
  official: {
    awayScore: number;
    awayTeamId: string;
    homeScore: number;
    homeTeamId: string;
  },
) {
  const homePlayerPoints = boxScores
    .filter((boxScore) => boxScore.teamId === official.homeTeamId)
    .reduce((total, boxScore) => total + boxScore.points, 0);
  const awayPlayerPoints = boxScores
    .filter((boxScore) => boxScore.teamId === official.awayTeamId)
    .reduce((total, boxScore) => total + boxScore.points, 0);
  const homeReconciled = homePlayerPoints === official.homeScore;
  const awayReconciled = awayPlayerPoints === official.awayScore;

  return {
    awayPlayerPoints,
    awayReconciled,
    homePlayerPoints,
    homeReconciled,
    reconciled: homeReconciled && awayReconciled,
  };
}

export function applyStatisticCommand(
  state: { events: StatisticRecordedEvent[]; version: number },
  command: StatisticCommand,
) {
  if (
    state.events.some(
      (event) => event.idempotencyKey === command.idempotencyKey,
    )
  ) {
    return {
      ...state,
      boxScores: projectPlayerBoxScores(state.events),
      idempotent: true,
    };
  }
  if (state.version !== command.expectedVersion) {
    throw new Error(
      'Statistics changed on another device. Refresh before continuing.',
    );
  }

  let playerId = command.playerId;
  let teamId = command.teamId;
  let type = command.type;
  let value = command.value;
  let reversesEventId: string | null = null;

  if (command.reversesEventId) {
    const original = state.events.find(
      (event) => event.id === command.reversesEventId,
    );
    if (!original || original.reversesEventId) {
      throw new Error('The statistic selected for reversal was not found.');
    }
    if (
      state.events.some(
        (event) => event.reversesEventId === command.reversesEventId,
      )
    ) {
      throw new Error('This statistic has already been reversed.');
    }
    playerId = original.playerId;
    teamId = original.teamId;
    type = original.type;
    value = original.value;
    reversesEventId = original.id;
  }

  if (!playerId || !teamId || !type || value === undefined) {
    throw new Error('Choose a player and statistic before saving.');
  }
  validateStatisticEvent({ type, value });

  const event: StatisticRecordedEvent = {
    id: command.eventId,
    idempotencyKey: command.idempotencyKey,
    playerId,
    reversesEventId,
    sequence: state.version + 1,
    teamId,
    type,
    value,
  };
  const events = [...state.events, event];

  return {
    boxScores: projectPlayerBoxScores(events),
    events,
    idempotent: false,
    version: state.version + 1,
  };
}
