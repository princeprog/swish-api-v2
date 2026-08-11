import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('compliance notification migration', () => {
  const source = readFileSync(
    join(
      __dirname,
      'migrations',
      '1787000000003_add_compliance_notification_category.ts',
    ),
    'utf8',
  );

  it('adds the compliance notification category without weakening existing categories', () => {
    expect(source).toContain(
      'drop constraint if exists notifications_category_check',
    );
    expect(source).toContain("'compliance'");
    expect(source).toContain("'competition'");
  });

  it('restores the original category set on rollback', () => {
    const downSource = source.slice(
      source.indexOf('export async function down'),
    );
    expect(downSource).toContain(
      "check (category in ('access', 'roster', 'schedule', 'scoring', 'competition'))",
    );
    expect(downSource).not.toContain(
      "check (category in ('access', 'roster', 'schedule', 'scoring', 'competition', 'compliance'))",
    );
  });
});
