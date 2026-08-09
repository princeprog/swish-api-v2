export type NotificationCursor = {
  createdAt: Date;
  id: string;
};

export function encodeNotificationCursor(
  createdAt: Date,
  id: string,
): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
  ).toString('base64url');
}

export function decodeNotificationCursor(value: string): NotificationCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as { createdAt?: unknown; id?: unknown };
    const createdAt =
      typeof decoded.createdAt === 'string'
        ? new Date(decoded.createdAt)
        : new Date(Number.NaN);

    if (
      typeof decoded.id !== 'string' ||
      !decoded.id ||
      Number.isNaN(createdAt.getTime())
    ) {
      throw new Error('Invalid notification cursor');
    }

    return { createdAt, id: decoded.id };
  } catch {
    throw new Error('Invalid notification cursor');
  }
}

export function normalizeNotificationLimit(limit?: number): number {
  if (limit === undefined || Number.isNaN(limit)) {
    return 20;
  }

  return Math.min(50, Math.max(1, Math.trunc(limit)));
}
