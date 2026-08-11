import {
  NOTIFICATION_EVENT_DEFINITIONS,
  NOTIFICATION_EVENT_TYPES,
  renderNotification,
  type NotificationEventType,
} from './notification.events';

describe('notification event registry', () => {
  it('registers every launch and reserved event with a delivery policy', () => {
    expect(Object.keys(NOTIFICATION_EVENT_DEFINITIONS)).toEqual(
      expect.arrayContaining(NOTIFICATION_EVENT_TYPES),
    );

    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      const definition = NOTIFICATION_EVENT_DEFINITIONS[eventType];

      expect(definition.category).toBeTruthy();
      expect(definition.priority).toBeTruthy();
      expect(definition.actionPath).toBeDefined();
    }
  });

  it('renders invitation copy and a safe action path from trusted context', () => {
    const notification = renderNotification('access.invitation_received', {
      organizationName: 'Barangay Hoops',
      invitationId: 'invitation-123',
      roleLabel: 'Team manager',
    });

    expect(notification.title).toBe('You have a new league invitation');
    expect(notification.body).toContain('Barangay Hoops');
    expect(notification.body).toContain('Team manager');
    expect(notification.actionUrl).toBe('/invitations/invitation-123');
  });

  it('renders finalized game copy with the official result context', () => {
    const notification = renderNotification('scoring.game_finalized', {
      organizationName: 'Barangay Hoops',
      organizationSlug: 'barangay-hoops',
      gameId: 'game-123',
      gameLabel: 'Northside vs Riverside',
      resultLabel: 'Northside 82–77 Riverside',
    });

    expect(notification.title).toBe('Official game result is ready');
    expect(notification.body).toContain('Northside vs Riverside');
    expect(notification.body).toContain('Northside 82–77 Riverside');
    expect(notification.actionUrl).toBe(
      '/organizations/barangay-hoops/schedules?gameId=game-123',
    );
  });

  it('renders team compliance reminders with a manager action path', () => {
    const notification = renderNotification('compliance.deadline_reminder', {
      organizationName: 'Barangay Hoops',
      organizationSlug: 'barangay-hoops',
      teamId: 'team-123',
      teamName: 'Northside',
      divisionName: 'Open Division',
      deadlineLabel: 'Aug 20, 2026, 6:00 PM',
    });

    expect(notification.title).toBe('A compliance deadline is approaching');
    expect(notification.body).toContain('Northside');
    expect(notification.actionUrl).toBe(
      '/organizations/barangay-hoops/requirements?teamId=team-123',
    );
  });

  it('keeps reserved events renderable before their workflows are wired', () => {
    const notification = renderNotification('playoffs.champion_confirmed', {
      organizationName: 'Barangay Hoops',
      organizationSlug: 'barangay-hoops',
      teamName: 'Northside',
    });

    expect(notification.title).toBe('League champion confirmed');
    expect(notification.body).toContain('Northside');
    expect(notification.actionUrl).toBe('/organizations/barangay-hoops');
  });

  it('does not accept arbitrary event names', () => {
    const eventType: NotificationEventType = 'access.member_suspended';
    expect(NOTIFICATION_EVENT_DEFINITIONS[eventType].category).toBe('access');
  });
});
