import {
  buildNotificationInsertValues,
  NotificationWriter,
} from './notification.writer';

describe('notification writer', () => {
  it('builds a user-targeted row with snapshotted copy and a recipient-safe dedupe key', () => {
    const row = buildNotificationInsertValues(
      {
        actorUserId: 'actor-1',
        context: {
          organizationName: 'Barangay Hoops',
          organizationSlug: 'barangay-hoops',
          gameId: 'game-1',
          gameLabel: 'Northside vs Riverside',
        },
        dedupeKey: 'game-1:published',
        eventType: 'schedule.game_published',
        organizationId: 'org-1',
        resourceId: 'game-1',
        resourceType: 'game',
      },
      { userId: 'user-1' },
      new Date('2026-08-09T00:00:00.000Z'),
    );

    expect(row).toMatchObject({
      actor_user_id: 'actor-1',
      category: 'schedule',
      dedupe_key: 'game-1:published:user:user-1',
      event_type: 'schedule.game_published',
      organization_id: 'org-1',
      priority: 'informational',
      recipient_email: null,
      recipient_user_id: 'user-1',
      resource_id: 'game-1',
      resource_type: 'game',
      title: 'A game was added to the official schedule',
    });
    expect(row.body).toContain('Northside vs Riverside');
    expect(row.action_url).toBe(
      '/organizations/barangay-hoops/schedules?gameId=game-1',
    );
    expect(row.retain_until).toEqual(new Date('2026-11-07T00:00:00.000Z'));
  });

  it('keeps invitation email targets and action expiry separate from retention', () => {
    const row = buildNotificationInsertValues(
      {
        context: {
          invitationId: 'inv-1',
          organizationName: 'Barangay Hoops',
          roleLabel: 'Scorekeeper',
        },
        dedupeKey: 'inv-1:received',
        eventType: 'access.invitation_received',
        organizationId: 'org-1',
        actionExpiresAt: new Date('2026-08-16T00:00:00.000Z'),
        retainUntil: new Date('2026-11-14T00:00:00.000Z'),
        resourceId: 'inv-1',
        resourceType: 'invitation',
      },
      { email: ' Coach@Example.COM ' },
      new Date('2026-08-09T00:00:00.000Z'),
    );

    expect(row).toMatchObject({
      action_expires_at: new Date('2026-08-16T00:00:00.000Z'),
      dedupe_key: 'inv-1:received:email:coach@example.com',
      recipient_email: 'coach@example.com',
      recipient_user_id: null,
      retain_until: new Date('2026-11-14T00:00:00.000Z'),
    });
  });

  it('clears stale invitation actions without deleting history', async () => {
    const execute = jest.fn().mockResolvedValue({ numUpdatedRows: 2 });
    const query: any = {
      execute,
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    };
    const db: any = {
      updateTable: jest.fn().mockReturnValue(query),
    };
    const writer = new NotificationWriter(db);

    await writer.clearInvitationActions('inv-1', db);

    expect(db.updateTable).toHaveBeenCalledWith('notification.notifications');
    expect(query.set).toHaveBeenCalledWith(
      expect.objectContaining({ action_expires_at: null, action_url: null }),
    );
    expect(query.where).toHaveBeenCalledWith('resource_id', '=', 'inv-1');
    expect(execute).toHaveBeenCalled();
  });
});
