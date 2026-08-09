import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('notifications migration', () => {
  const migrationSource = readFileSync(
    join(__dirname, 'migrations', '1787000000000_add_notifications.ts'),
    'utf8',
  );

  it('creates the notification schema and durable recipient rows', () => {
    expect(migrationSource).toContain("createSchema('notification')");
    expect(migrationSource).toContain("createTable('notification.notifications')");
    expect(migrationSource).toContain("addColumn('recipient_user_id', 'uuid'");
    expect(migrationSource).toContain("addColumn('recipient_email', 'varchar(320)'");
    expect(migrationSource).toContain("addColumn('dedupe_key', 'varchar(255)'");
    expect(migrationSource).toContain('notification_recipient_user_created_index');
  });

  it('protects notification categories, priorities, recipient identity, and deduplication', () => {
    expect(migrationSource).toContain('notifications_category_check');
    expect(migrationSource).toContain('notifications_priority_check');
    expect(migrationSource).toContain('notifications_recipient_check');
    expect(migrationSource).toContain('notifications_recipient_identity_check');
    expect(migrationSource).toContain('notifications_dedupe_key_unique');
    expect(migrationSource).toContain('notification_unread_email_index');
    expect(migrationSource).toContain('notification_action_expiry_index');
  });

  it('keeps historical rows when organizations or actors are removed', () => {
    expect(migrationSource).toContain(".onDelete('set null')");
    expect(migrationSource).toContain("dropTable('notification.notifications')");
    expect(migrationSource).toContain("dropSchema('notification')");
  });
});
