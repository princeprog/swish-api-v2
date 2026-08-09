export type NotificationRecipient = {
  email?: string;
  userId?: string;
};

export function normalizeRecipient(
  recipient: NotificationRecipient,
): NotificationRecipient {
  const userId = recipient.userId?.trim() || undefined;
  const email = recipient.email?.trim().toLowerCase() || undefined;

  if (!userId && !email) {
    throw new Error('A notification recipient needs a user or email address');
  }

  return { email, userId };
}

export function dedupeRecipients(
  recipients: NotificationRecipient[],
): NotificationRecipient[] {
  const seen = new Set<string>();
  const result: NotificationRecipient[] = [];

  for (const candidate of recipients) {
    const recipient = normalizeRecipient(candidate);
    const key = recipient.userId
      ? `user:${recipient.userId}`
      : `email:${recipient.email}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(recipient);
  }

  return result;
}

export function withoutActor(
  recipients: NotificationRecipient[],
  actorUserId?: string,
): NotificationRecipient[] {
  if (!actorUserId) {
    return dedupeRecipients(recipients);
  }

  return dedupeRecipients(
    recipients.filter((recipient) => recipient.userId !== actorUserId),
  );
}
