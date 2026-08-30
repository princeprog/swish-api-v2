export type ScheduleSlot = {
  awayTeamId: string;
  homeTeamId: string;
  startsAt: Date;
  venueId: string;
};

export type ExistingScheduleSlot = ScheduleSlot & { id: string };

export type ScheduleConflict = {
  conflictingGameId: string;
  kind: 'team' | 'venue';
  resourceId: string;
};

export function findScheduleConflict(
  proposed: ScheduleSlot,
  slotDurationMinutes: number,
  existingSlots: ExistingScheduleSlot[],
  excludedGameId?: string,
): ScheduleConflict | null {
  const durationMs = slotDurationMinutes * 60_000;
  const proposedStart = proposed.startsAt.getTime();
  const proposedEnd = proposedStart + durationMs;

  for (const existing of existingSlots) {
    if (existing.id === excludedGameId) continue;
    const existingStart = existing.startsAt.getTime();
    const existingEnd = existingStart + durationMs;
    const overlaps = proposedStart < existingEnd && existingStart < proposedEnd;
    if (!overlaps) continue;

    const proposedTeams = new Set([
      proposed.homeTeamId,
      proposed.awayTeamId,
    ]);
    const conflictingTeamId = [
      existing.homeTeamId,
      existing.awayTeamId,
    ].find((teamId) => proposedTeams.has(teamId));
    if (conflictingTeamId) {
      return {
        conflictingGameId: existing.id,
        kind: 'team',
        resourceId: conflictingTeamId,
      };
    }
    if (existing.venueId === proposed.venueId) {
      return {
        conflictingGameId: existing.id,
        kind: 'venue',
        resourceId: existing.venueId,
      };
    }
  }

  return null;
}
