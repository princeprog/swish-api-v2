import {
  dedupeRecipients,
  normalizeRecipient,
  withoutActor,
  type NotificationRecipient,
} from './notification.recipients';

describe('notification recipient rules', () => {
  it('normalizes invitation email recipients', () => {
    expect(normalizeRecipient({ email: '  Coach@Example.COM ' })).toEqual({
      email: 'coach@example.com',
      userId: undefined,
    });
  });

  it('deduplicates recipients by user id or normalized email', () => {
    const recipients: NotificationRecipient[] = [
      { userId: 'user-1' },
      { userId: 'user-1' },
      { email: 'coach@example.com' },
      { email: ' Coach@Example.com ' },
    ];

    expect(dedupeRecipients(recipients)).toEqual([
      { userId: 'user-1' },
      { email: 'coach@example.com', userId: undefined },
    ]);
  });

  it('removes the actor without removing email-targeted invitations', () => {
    expect(
      withoutActor(
        [
          { userId: 'actor-1' },
          { userId: 'member-1' },
          { email: 'member@example.com' },
        ],
        'actor-1',
      ),
    ).toEqual([
      { userId: 'member-1' },
      { email: 'member@example.com', userId: undefined },
    ]);
  });

  it('rejects a recipient with neither user id nor email', () => {
    expect(() => normalizeRecipient({})).toThrow(
      'A notification recipient needs a user or email address',
    );
  });
});
