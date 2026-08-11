import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('division compliance migration', () => {
  const migrationSource = readFileSync(
    join(__dirname, 'migrations', '1786449478003_add_division_compliance.ts'),
    'utf8',
  );

  it('creates the isolated compliance settings, workflow, and projection tables', () => {
    expect(migrationSource).toContain("createSchema('compliance')");
    expect(migrationSource).toContain(
      "createTable('compliance.division_settings')",
    );
    expect(migrationSource).toContain("createTable('compliance.requirements')");
    expect(migrationSource).toContain(
      "createTable('compliance.team_submissions')",
    );
    expect(migrationSource).toContain(
      "createTable('compliance.team_clearance_projections')",
    );
    expect(migrationSource).toContain(
      'compliance_team_submissions_team_requirement_unique',
    );
    expect(migrationSource).toContain(
      'compliance_team_clearance_projections_team_settings_unique',
    );
    expect(migrationSource).toContain(
      'compliance_team_clearance_projections_team_settings_status_index',
    );
    expect(migrationSource).toContain(
      'compliance_team_clearance_projections_settings_status_index',
    );
    expect(migrationSource).toContain(
      "columns(['team_id', 'division_settings_id', 'status'])",
    );
    expect(migrationSource).toContain("defaultTo('draft')");
    expect(migrationSource).toContain(
      "status = 'draft' and published_at is null and archived_at is null",
    );
    expect(migrationSource).toContain(
      'compliance_submission_attempts_id_submission_unique',
    );
    expect(migrationSource).toContain("['current_attempt_id', 'id']");
    expect(migrationSource).toContain("['id', 'submission_id']");
  });

  it('preserves immutable attempts and private, bounded evidence files', () => {
    expect(migrationSource).toContain(
      "createTable('compliance.submission_attempts')",
    );
    expect(migrationSource).toContain(
      'prevent_compliance_submission_attempt_mutation_trigger',
    );
    expect(migrationSource).toContain(
      'Compliance submission attempts are immutable',
    );
    expect(migrationSource).toContain(
      "createTable('compliance.submission_files')",
    );
    expect(migrationSource).toContain('file_order between 1 and 5');
    expect(migrationSource).toContain('byte_size between 1 and 10485760');
    expect(migrationSource).toContain('application/pdf');
    expect(migrationSource).toContain('image/jpeg');
    expect(migrationSource).toContain('image/png');
  });

  it('keeps compliance opt-in without seeding submissions or clearance projections', () => {
    const upStart = migrationSource.indexOf('export async function up');
    const downStart = migrationSource.indexOf('export async function down');

    expect(upStart).toBeGreaterThanOrEqual(0);
    expect(downStart).toBeGreaterThan(upStart);

    const upSource = migrationSource.slice(upStart, downStart);

    expect(upSource).toContain("defaultTo('draft')");
    expect(upSource).toContain(
      "status = 'draft' and published_at is null and archived_at is null",
    );
    expect(upSource).not.toMatch(
      /\.insertInto\(\s*['"]compliance\.(team_submissions|team_clearance_projections)['"]\s*\)/,
    );
    expect(upSource).not.toMatch(
      /\binsert\s+into\s+compliance\.(team_submissions|team_clearance_projections)\b/i,
    );
  });

  it('creates event and scan-job history, then drops dependencies in reverse order', () => {
    expect(migrationSource).toContain(
      "createTable('compliance.submission_events')",
    );
    expect(migrationSource).toContain(
      "createTable('compliance.file_scan_jobs')",
    );
    expect(migrationSource).toContain('compliance_file_scan_jobs_queue_index');

    const downSource = migrationSource.slice(
      migrationSource.indexOf('export async function down'),
    );

    expect(
      downSource.indexOf("dropTable('compliance.file_scan_jobs')"),
    ).toBeLessThan(
      downSource.indexOf("dropTable('compliance.submission_files')"),
    );
    const currentAttemptForeignKeyDropIndex = downSource.indexOf(
      "dropConstraint('compliance_team_submissions_current_attempt_fk')",
    );
    const submissionAttemptsDropIndex = downSource.indexOf(
      "dropTable('compliance.submission_attempts')",
    );
    const teamSubmissionsDropIndex = downSource.indexOf(
      "dropTable('compliance.team_submissions')",
    );

    expect(currentAttemptForeignKeyDropIndex).toBeGreaterThanOrEqual(0);
    expect(submissionAttemptsDropIndex).toBeGreaterThanOrEqual(0);
    expect(currentAttemptForeignKeyDropIndex).toBeLessThan(
      submissionAttemptsDropIndex,
    );
    expect(submissionAttemptsDropIndex).toBeLessThan(teamSubmissionsDropIndex);
    expect(downSource).toContain("dropSchema('compliance')");
  });
});
