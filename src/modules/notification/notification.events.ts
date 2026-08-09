export const NOTIFICATION_EVENT_TYPES = [
  'access.invitation_received',
  'access.invitation_resent',
  'access.invitation_expiring',
  'access.invitation_scope_changed',
  'access.invitation_revoked',
  'access.invitation_accepted',
  'access.member_role_changed',
  'access.member_team_scope_changed',
  'access.member_suspended',
  'access.member_reactivated',
  'access.ownership_received',
  'access.ownership_transferred',
  'roster.deadline_set',
  'roster.deadline_changed',
  'roster.deadline_reminder',
  'roster.overdue',
  'roster.submitted',
  'roster.returned',
  'roster.approved',
  'roster.published',
  'roster.amendment_started',
  'schedule.scorekeeper_assigned',
  'schedule.scorekeeper_unassigned',
  'schedule.game_published',
  'schedule.game_changed',
  'schedule.game_postponed',
  'schedule.game_removed',
  'schedule.game_reminder',
  'schedule.unassigned_game_reminder',
  'scoring.control_taken_over',
  'scoring.game_finalized',
  'scoring.game_reopened',
  'scoring.result_corrected',
  'standings.tie_requires_decision',
  'standings.tie_decision_published',
  'playoffs.qualification_confirmed',
  'playoffs.matchup_set',
  'playoffs.matchup_changed',
  'playoffs.team_advanced',
  'playoffs.team_eliminated',
  'playoffs.champion_confirmed',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationCategory =
  | 'access'
  | 'roster'
  | 'schedule'
  | 'scoring'
  | 'competition';

export type NotificationPriority =
  | 'action_required'
  | 'important'
  | 'informational';

export type NotificationRenderContext = {
  organizationName?: string;
  organizationSlug?: string;
  invitationId?: string;
  roleLabel?: string;
  memberName?: string;
  teamName?: string;
  gameId?: string;
  gameLabel?: string;
  resultLabel?: string;
  rosterLabel?: string;
  deadlineLabel?: string;
  reviewNote?: string;
  reminderLabel?: string;
  reason?: string;
};

export type RenderedNotification = {
  actionUrl: string | null;
  body: string;
  title: string;
};

export type NotificationEventDefinition = {
  actionPath: (context: NotificationRenderContext) => string | null;
  category: NotificationCategory;
  defaultTitle: string;
  priority: NotificationPriority;
};

const organizationPath = (context: NotificationRenderContext) =>
  context.organizationSlug
    ? `/organizations/${encodeURIComponent(context.organizationSlug)}`
    : null;

const schedulePath = (context: NotificationRenderContext) => {
  if (!context.organizationSlug) {
    return null;
  }

  const base = `/organizations/${encodeURIComponent(context.organizationSlug)}/schedules`;
  return context.gameId ? `${base}?gameId=${encodeURIComponent(context.gameId)}` : base;
};

const invitationPath = (context: NotificationRenderContext) =>
  context.invitationId
    ? `/invitations/${encodeURIComponent(context.invitationId)}`
    : '/invitations/accept';

const definition = (
  category: NotificationCategory,
  priority: NotificationPriority,
  defaultTitle: string,
  actionPath: NotificationEventDefinition['actionPath'] = organizationPath,
): NotificationEventDefinition => ({
  actionPath,
  category,
  defaultTitle,
  priority,
});

export const NOTIFICATION_EVENT_DEFINITIONS: Record<
  NotificationEventType,
  NotificationEventDefinition
> = {
  'access.invitation_received': definition('access', 'action_required', 'You have a new league invitation', invitationPath),
  'access.invitation_resent': definition('access', 'action_required', 'Your league invitation was sent again', invitationPath),
  'access.invitation_expiring': definition('access', 'action_required', 'Your league invitation is expiring soon', invitationPath),
  'access.invitation_scope_changed': definition('access', 'important', 'Your invitation access was updated', invitationPath),
  'access.invitation_revoked': definition('access', 'important', 'Your league invitation was revoked', () => null),
  'access.invitation_accepted': definition('access', 'informational', 'A league invitation was accepted'),
  'access.member_role_changed': definition('access', 'important', 'Your league role was changed'),
  'access.member_team_scope_changed': definition('access', 'important', 'Your team access was updated'),
  'access.member_suspended': definition('access', 'action_required', 'Your league access was suspended'),
  'access.member_reactivated': definition('access', 'informational', 'Your league access was restored'),
  'access.ownership_received': definition('access', 'action_required', 'You are now the league owner'),
  'access.ownership_transferred': definition('access', 'important', 'League ownership was transferred'),
  'roster.deadline_set': definition('roster', 'important', 'A roster deadline was set'),
  'roster.deadline_changed': definition('roster', 'important', 'A roster deadline changed'),
  'roster.deadline_reminder': definition('roster', 'action_required', 'A roster deadline is approaching'),
  'roster.overdue': definition('roster', 'action_required', 'A roster is past its deadline'),
  'roster.submitted': definition('roster', 'action_required', 'A team roster is ready for review'),
  'roster.returned': definition('roster', 'action_required', 'A team roster needs changes'),
  'roster.approved': definition('roster', 'informational', 'A team roster was approved'),
  'roster.published': definition('roster', 'informational', 'A team roster is now official'),
  'roster.amendment_started': definition('roster', 'action_required', 'A published roster needs an amendment'),
  'schedule.scorekeeper_assigned': definition('schedule', 'action_required', 'You were assigned to score a game', schedulePath),
  'schedule.scorekeeper_unassigned': definition('schedule', 'important', 'You are no longer assigned to a game', schedulePath),
  'schedule.game_published': definition('schedule', 'informational', 'A game was added to the official schedule', schedulePath),
  'schedule.game_changed': definition('schedule', 'important', 'A scheduled game was changed', schedulePath),
  'schedule.game_postponed': definition('schedule', 'action_required', 'A scheduled game was postponed', schedulePath),
  'schedule.game_removed': definition('schedule', 'action_required', 'A scheduled game was removed', schedulePath),
  'schedule.game_reminder': definition('schedule', 'action_required', 'An assigned game is coming up', schedulePath),
  'schedule.unassigned_game_reminder': definition('schedule', 'action_required', 'A game still needs a scorekeeper', schedulePath),
  'scoring.control_taken_over': definition('scoring', 'action_required', 'Scoring control was taken over', schedulePath),
  'scoring.game_finalized': definition('scoring', 'informational', 'Official game result is ready', schedulePath),
  'scoring.game_reopened': definition('scoring', 'action_required', 'An official game was reopened', schedulePath),
  'scoring.result_corrected': definition('scoring', 'important', 'An official game result was corrected', schedulePath),
  'standings.tie_requires_decision': definition('competition', 'action_required', 'A standings tie needs a decision'),
  'standings.tie_decision_published': definition('competition', 'informational', 'A standings tie decision was published'),
  'playoffs.qualification_confirmed': definition('competition', 'informational', 'Your team qualified for the playoffs'),
  'playoffs.matchup_set': definition('competition', 'action_required', 'A playoff matchup was set'),
  'playoffs.matchup_changed': definition('competition', 'important', 'A playoff matchup changed'),
  'playoffs.team_advanced': definition('competition', 'informational', 'Your team advanced'),
  'playoffs.team_eliminated': definition('competition', 'informational', 'Your team was eliminated'),
  'playoffs.champion_confirmed': definition('competition', 'informational', 'League champion confirmed'),
};

function organizationLabel(context: NotificationRenderContext): string {
  return context.organizationName ?? 'your league';
}

function gameLabel(context: NotificationRenderContext): string {
  return context.gameLabel ?? 'A scheduled game';
}

export function renderNotification(
  eventType: NotificationEventType,
  context: NotificationRenderContext = {},
): RenderedNotification {
  const event = NOTIFICATION_EVENT_DEFINITIONS[eventType];
  const organization = organizationLabel(context);
  let body = `${event.defaultTitle} in ${organization}.`;

  switch (eventType) {
    case 'access.invitation_received':
      body = `You were invited to join ${organization} as ${context.roleLabel ?? 'league staff'}.`;
      break;
    case 'access.invitation_resent':
      body = `Your invitation to join ${organization} as ${context.roleLabel ?? 'league staff'} was sent again.`;
      break;
    case 'access.invitation_expiring':
      body = `Your invitation to join ${organization} expires soon.`;
      break;
    case 'access.invitation_scope_changed':
      body = `Your team access for ${organization} was updated before you joined.`;
      break;
    case 'access.invitation_revoked':
      body = `Your invitation to join ${organization} is no longer available.`;
      break;
    case 'access.invitation_accepted':
      body = `${context.memberName ?? 'A staff member'} accepted an invitation to ${organization}.`;
      break;
    case 'access.member_role_changed':
      body = `Your role in ${organization} is now ${context.roleLabel ?? 'updated'}.`;
      break;
    case 'access.member_team_scope_changed':
      body = `Your assigned team access in ${organization} was updated.`;
      break;
    case 'access.member_suspended':
      body = `Your access to ${organization} is temporarily suspended.`;
      break;
    case 'access.member_reactivated':
      body = `Your access to ${organization} has been restored.`;
      break;
    case 'access.ownership_received':
      body = `You are now responsible for organization settings and staff access in ${organization}.`;
      break;
    case 'access.ownership_transferred':
      body = `Ownership of ${organization} was transferred to another owner.`;
      break;
    case 'roster.deadline_set':
    case 'roster.deadline_changed':
      body = `${context.rosterLabel ?? 'Your team roster'} is due ${context.deadlineLabel ?? 'by the published deadline'}.`;
      break;
    case 'roster.deadline_reminder':
      body = `${context.rosterLabel ?? 'Your team roster'} is due ${context.deadlineLabel ?? 'soon'}.`;
      break;
    case 'roster.overdue':
      body = `${context.rosterLabel ?? 'A team roster'} missed its deadline${context.deadlineLabel ? ` on ${context.deadlineLabel}` : ''}.`;
      break;
    case 'roster.submitted':
      body = `${context.rosterLabel ?? 'A team roster'} was submitted for review in ${organization}.`;
      break;
    case 'roster.returned':
      body = `${context.rosterLabel ?? 'Your team roster'} was returned for changes${context.reviewNote ? `: ${context.reviewNote}` : '.'}`;
      break;
    case 'roster.approved':
      body = `${context.rosterLabel ?? 'Your team roster'} was approved in ${organization}.`;
      break;
    case 'roster.published':
      body = `${context.rosterLabel ?? 'Your team roster'} is now official in ${organization}.`;
      break;
    case 'roster.amendment_started':
      body = `${context.rosterLabel ?? 'A published roster'} needs an amendment in ${organization}.`;
      break;
    case 'schedule.scorekeeper_assigned':
      body = `You are assigned to score ${gameLabel(context)} in ${organization}.`;
      break;
    case 'schedule.scorekeeper_unassigned':
      body = `You are no longer assigned to score ${gameLabel(context)}.`;
      break;
    case 'schedule.game_published':
      body = `${gameLabel(context)} was added to the official schedule in ${organization}.`;
      break;
    case 'schedule.game_changed':
      body = `${gameLabel(context)} has a schedule, venue, or team change.`;
      break;
    case 'schedule.game_postponed':
      body = `${gameLabel(context)} was postponed. Check the schedule for the latest details.`;
      break;
    case 'schedule.game_removed':
      body = `${gameLabel(context)} was removed from the published schedule.`;
      break;
    case 'schedule.game_reminder':
      body = `${gameLabel(context)} is ${context.reminderLabel ?? 'coming up soon'}.`;
      break;
    case 'schedule.unassigned_game_reminder':
      body = `${gameLabel(context)} is coming up and still needs a scorekeeper.`;
      break;
    case 'scoring.control_taken_over':
      body = `Another scorekeeper took control of ${gameLabel(context)}${context.reason ? `: ${context.reason}` : '.'}`;
      break;
    case 'scoring.game_finalized':
      body = `${gameLabel(context)} is official${context.resultLabel ? `: ${context.resultLabel}` : '.'}`;
      break;
    case 'scoring.game_reopened':
      body = `${gameLabel(context)} was reopened for an official correction.`;
      break;
    case 'scoring.result_corrected':
      body = `${gameLabel(context)} has a corrected official result${context.resultLabel ? `: ${context.resultLabel}` : '.'}`;
      break;
    case 'standings.tie_requires_decision':
      body = `A standings tie in ${organization} needs an admin decision before rankings are official.`;
      break;
    case 'standings.tie_decision_published':
      body = `The standings tie decision for ${organization} is now published.`;
      break;
    case 'playoffs.qualification_confirmed':
      body = `${context.teamName ?? 'Your team'} qualified for the playoffs in ${organization}.`;
      break;
    case 'playoffs.matchup_set':
      body = `A playoff matchup was set for ${context.teamName ?? 'your team'} in ${organization}.`;
      break;
    case 'playoffs.matchup_changed':
      body = `A playoff matchup involving ${context.teamName ?? 'your team'} changed in ${organization}.`;
      break;
    case 'playoffs.team_advanced':
      body = `${context.teamName ?? 'Your team'} advanced in the ${organization} playoffs.`;
      break;
    case 'playoffs.team_eliminated':
      body = `${context.teamName ?? 'Your team'} was eliminated from the ${organization} playoffs.`;
      break;
    case 'playoffs.champion_confirmed':
      body = `${context.teamName ?? 'The champion'} was confirmed as the champion of ${organization}.`;
      break;
  }

  return {
    actionUrl: event.actionPath(context),
    body,
    title: event.defaultTitle,
  };
}
