import {
  isNotificationReminderWindow,
  notificationRetentionDate,
} from './notification.jobs';

describe('notification reminder windows', () => {
  const now = new Date('2026-08-09T00:00:00.000Z');

  it('selects a 24-hour reminder only after the one-hour window', () => {
    expect(
      isNotificationReminderWindow(
        new Date('2026-08-09T20:00:00.000Z'),
        now,
        24,
        1,
      ),
    ).toBe(true);
    expect(
      isNotificationReminderWindow(
        new Date('2026-08-09T00:30:00.000Z'),
        now,
        24,
        1,
      ),
    ).toBe(false);
  });

  it('selects an imminent reminder inside the one-hour window', () => {
    expect(
      isNotificationReminderWindow(
        new Date('2026-08-09T00:30:00.000Z'),
        now,
        1,
        0,
      ),
    ).toBe(true);
    expect(
      isNotificationReminderWindow(
        new Date('2026-08-08T23:59:00.000Z'),
        now,
        1,
        0,
      ),
    ).toBe(false);
  });

  it('retains an invitation until 90 days after its expiry', () => {
    expect(notificationRetentionDate(new Date('2026-08-16T00:00:00.000Z'))).toEqual(
      new Date('2026-11-14T00:00:00.000Z'),
    );
  });
});
