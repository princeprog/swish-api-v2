import {
  decodeNotificationCursor,
  encodeNotificationCursor,
  normalizeNotificationLimit,
} from './notification.pagination';

describe('notification pagination', () => {
  it('round-trips an opaque cursor without exposing its fields', () => {
    const cursor = encodeNotificationCursor(
      new Date('2026-08-09T12:30:00.000Z'),
      'notification-1',
    );

    expect(cursor).not.toContain('2026-08-09');
    expect(decodeNotificationCursor(cursor)).toEqual({
      createdAt: new Date('2026-08-09T12:30:00.000Z'),
      id: 'notification-1',
    });
  });

  it('rejects malformed cursors instead of changing the result window', () => {
    expect(() => decodeNotificationCursor('not-a-cursor')).toThrow(
      'Invalid notification cursor',
    );
  });

  it('clamps page size to the public API limits', () => {
    expect(normalizeNotificationLimit(undefined)).toBe(20);
    expect(normalizeNotificationLimit(0)).toBe(1);
    expect(normalizeNotificationLimit(75)).toBe(50);
    expect(normalizeNotificationLimit(12)).toBe(12);
  });
});
