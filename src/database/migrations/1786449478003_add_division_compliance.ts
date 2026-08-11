import type { Kysely } from 'kysely';
import { sql } from 'kysely';

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createSchema('compliance').ifNotExists().execute();

  await db.schema
    .createTable('compliance.division_settings')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_id', 'uuid', (column) =>
      column.notNull().references('admin.divisions.id').onDelete('cascade'),
    )
    // Draft settings do not activate compliance. Runtime enforcement must only
    // consider settings after their explicit transition to published.
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('draft'),
    )
    .addColumn('published_at', 'timestamptz')
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_by_member_id', 'uuid', (column) =>
      column
        .notNull()
        .references('admin.organization_members.id')
        .onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('division_compliance_settings_division_unique', [
      'division_id',
    ])
    .addCheckConstraint(
      'division_compliance_settings_status_check',
      sql`status in ('draft', 'published', 'archived')`,
    )
    .addCheckConstraint(
      'division_compliance_settings_lifecycle_check',
      sql`
				(status = 'draft' and published_at is null and archived_at is null)
				or (status = 'published' and published_at is not null and archived_at is null)
				or (status = 'archived' and published_at is not null and archived_at is not null)
			`,
    )
    .execute();

  await db.schema
    .createTable('compliance.requirements')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('division_settings_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.division_settings.id')
        .onDelete('cascade'),
    )
    .addColumn('title', 'varchar(160)', (column) => column.notNull())
    .addColumn('instructions', 'text')
    .addColumn('response_type', 'varchar(24)', (column) => column.notNull())
    .addColumn('is_required', 'boolean', (column) =>
      column.notNull().defaultTo(true),
    )
    .addColumn('max_file_count', 'integer', (column) =>
      column.notNull().defaultTo(5),
    )
    .addColumn('sort_order', 'integer', (column) => column.notNull())
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('compliance_requirements_settings_order_unique', [
      'division_settings_id',
      'sort_order',
    ])
    .addCheckConstraint(
      'compliance_requirements_response_type_check',
      sql`response_type in ('file', 'short_text', 'long_text', 'url', 'acknowledgement')`,
    )
    .addCheckConstraint(
      'compliance_requirements_file_count_check',
      sql`max_file_count between 1 and 5`,
    )
    .addCheckConstraint(
      'compliance_requirements_sort_order_check',
      sql`sort_order >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('compliance_requirements_settings_id_index')
    .on('compliance.requirements')
    .column('division_settings_id')
    .execute();

  await db.schema
    .createTable('compliance.team_submissions')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('cascade'),
    )
    .addColumn('requirement_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.requirements.id')
        .onDelete('cascade'),
    )
    .addColumn('current_attempt_id', 'uuid')
    .addColumn('workflow_status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('draft'),
    )
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('submitted_by_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('reviewed_at', 'timestamptz')
    .addColumn('reviewed_by_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('review_note', 'text')
    .addColumn('waived_at', 'timestamptz')
    .addColumn('waived_by_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('waiver_reason', 'text')
    .addColumn('waiver_expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint(
      'compliance_team_submissions_team_requirement_unique',
      ['team_id', 'requirement_id'],
    )
    .addCheckConstraint(
      'compliance_team_submissions_status_check',
      sql`workflow_status in ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'waived', 'reopened')`,
    )
    .addCheckConstraint(
      'compliance_team_submissions_waiver_check',
      sql`
				(workflow_status = 'waived' and waived_at is not null and waived_by_member_id is not null and waiver_reason is not null)
				or (workflow_status <> 'waived' and waived_at is null and waived_by_member_id is null and waiver_reason is null and waiver_expires_at is null)
			`,
    )
    .execute();

  await db.schema
    .createIndex('compliance_team_submissions_team_status_index')
    .on('compliance.team_submissions')
    .columns(['team_id', 'workflow_status'])
    .execute();

  await db.schema
    .createIndex('compliance_team_submissions_requirement_status_index')
    .on('compliance.team_submissions')
    .columns(['requirement_id', 'workflow_status'])
    .execute();

  await db.schema
    .createTable('compliance.submission_attempts')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('submission_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.team_submissions.id')
        .onDelete('cascade'),
    )
    .addColumn('attempt_number', 'integer', (column) => column.notNull())
    .addColumn('response_type', 'varchar(24)', (column) => column.notNull())
    .addColumn('response_value', 'jsonb', (column) => column.notNull())
    .addColumn('submitted_by_member_id', 'uuid', (column) =>
      column
        .notNull()
        .references('admin.organization_members.id')
        .onDelete('restrict'),
    )
    .addColumn('submitted_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint(
      'compliance_submission_attempts_submission_number_unique',
      ['submission_id', 'attempt_number'],
    )
    .addUniqueConstraint(
      'compliance_submission_attempts_id_submission_unique',
      ['id', 'submission_id'],
    )
    .addCheckConstraint(
      'compliance_submission_attempts_number_check',
      sql`attempt_number > 0`,
    )
    .addCheckConstraint(
      'compliance_submission_attempts_response_type_check',
      sql`response_type in ('file', 'short_text', 'long_text', 'url', 'acknowledgement')`,
    )
    .execute();

  await db.schema
    .alterTable('compliance.team_submissions')
    .addForeignKeyConstraint(
      'compliance_team_submissions_current_attempt_fk',
      ['current_attempt_id', 'id'],
      'compliance.submission_attempts',
      ['id', 'submission_id'],
    )
    .execute();

  await db.schema
    .createIndex('compliance_submission_attempts_submission_id_index')
    .on('compliance.submission_attempts')
    .column('submission_id')
    .execute();

  await db.schema
    .createTable('compliance.submission_files')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('submission_attempt_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.submission_attempts.id')
        .onDelete('cascade'),
    )
    .addColumn('file_order', 'integer', (column) => column.notNull())
    .addColumn('storage_provider', 'varchar(40)', (column) => column.notNull())
    .addColumn('storage_key', 'varchar(512)', (column) => column.notNull())
    .addColumn('original_filename', 'varchar(255)', (column) =>
      column.notNull(),
    )
    .addColumn('mime_type', 'varchar(100)', (column) => column.notNull())
    .addColumn('byte_size', 'integer', (column) => column.notNull())
    .addColumn('sha256', 'varchar(64)', (column) => column.notNull())
    .addColumn('verification_status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('pending_upload'),
    )
    .addColumn('uploaded_at', 'timestamptz')
    .addColumn('verified_at', 'timestamptz')
    .addColumn('rejection_reason', 'text')
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint('compliance_submission_files_attempt_order_unique', [
      'submission_attempt_id',
      'file_order',
    ])
    .addUniqueConstraint('compliance_submission_files_storage_key_unique', [
      'storage_provider',
      'storage_key',
    ])
    .addCheckConstraint(
      'compliance_submission_files_order_check',
      sql`file_order between 1 and 5`,
    )
    .addCheckConstraint(
      'compliance_submission_files_mime_type_check',
      sql`mime_type in ('application/pdf', 'image/jpeg', 'image/png')`,
    )
    .addCheckConstraint(
      'compliance_submission_files_byte_size_check',
      sql`byte_size between 1 and 10485760`,
    )
    .addCheckConstraint(
      'compliance_submission_files_sha256_check',
      sql`sha256 ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      'compliance_submission_files_verification_status_check',
      sql`verification_status in ('pending_upload', 'uploaded', 'scanning', 'verified', 'rejected', 'deleted')`,
    )
    .execute();

  await db.schema
    .createIndex('compliance_submission_files_attempt_id_index')
    .on('compliance.submission_files')
    .column('submission_attempt_id')
    .execute();

  await db.schema
    .createTable('compliance.submission_events')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('submission_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.team_submissions.id')
        .onDelete('cascade'),
    )
    .addColumn('submission_attempt_id', 'uuid', (column) =>
      column
        .references('compliance.submission_attempts.id')
        .onDelete('set null'),
    )
    .addColumn('actor_member_id', 'uuid', (column) =>
      column.references('admin.organization_members.id').onDelete('set null'),
    )
    .addColumn('event_type', 'varchar(80)', (column) => column.notNull())
    .addColumn('metadata', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .execute();

  await db.schema
    .createIndex('compliance_submission_events_submission_created_index')
    .on('compliance.submission_events')
    .columns(['submission_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('compliance.file_scan_jobs')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('submission_file_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.submission_files.id')
        .onDelete('cascade'),
    )
    .addColumn('provider', 'varchar(80)', (column) => column.notNull())
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('queued'),
    )
    .addColumn('attempt_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('next_attempt_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('result', 'jsonb', (column) =>
      column.notNull().defaultTo(sql`'{}'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addCheckConstraint(
      'compliance_file_scan_jobs_status_check',
      sql`status in ('queued', 'running', 'passed', 'failed', 'retryable')`,
    )
    .addCheckConstraint(
      'compliance_file_scan_jobs_attempt_count_check',
      sql`attempt_count >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('compliance_file_scan_jobs_queue_index')
    .on('compliance.file_scan_jobs')
    .columns(['status', 'next_attempt_at'])
    .execute();

  await db.schema
    .createTable('compliance.team_clearance_projections')
    .addColumn('id', 'uuid', (column) =>
      column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
    )
    .addColumn('team_id', 'uuid', (column) =>
      column.notNull().references('admin.teams.id').onDelete('cascade'),
    )
    .addColumn('division_settings_id', 'uuid', (column) =>
      column
        .notNull()
        .references('compliance.division_settings.id')
        .onDelete('cascade'),
    )
    .addColumn('status', 'varchar(24)', (column) =>
      column.notNull().defaultTo('pending'),
    )
    .addColumn('blocking_requirement_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('pending_requirement_count', 'integer', (column) =>
      column.notNull().defaultTo(0),
    )
    .addColumn('last_evaluated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('version', 'integer', (column) => column.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addColumn('updated_at', 'timestamptz', (column) =>
      column.notNull().defaultTo(db.fn('now')),
    )
    .addUniqueConstraint(
      'compliance_team_clearance_projections_team_settings_unique',
      ['team_id', 'division_settings_id'],
    )
    .addCheckConstraint(
      'compliance_team_clearance_projections_status_check',
      sql`status in ('not_required', 'pending', 'blocked', 'cleared')`,
    )
    .addCheckConstraint(
      'compliance_team_clearance_projections_counts_check',
      sql`blocking_requirement_count >= 0 and pending_requirement_count >= 0 and version >= 0`,
    )
    .execute();

  await db.schema
    .createIndex(
      'compliance_team_clearance_projections_team_settings_status_index',
    )
    .on('compliance.team_clearance_projections')
    .columns(['team_id', 'division_settings_id', 'status'])
    .execute();

  await db.schema
    .createIndex('compliance_team_clearance_projections_settings_status_index')
    .on('compliance.team_clearance_projections')
    .columns(['division_settings_id', 'status'])
    .execute();

  await sql`
		create function compliance.prevent_submission_attempt_mutation()
		returns trigger
		language plpgsql
		as $$
		begin
			raise exception 'Compliance submission attempts are immutable';
		end;
		$$
	`.execute(db);

  await sql`
		create trigger prevent_compliance_submission_attempt_mutation_trigger
		before update or delete on compliance.submission_attempts
		for each row
		execute function compliance.prevent_submission_attempt_mutation()
	`.execute(db);
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('compliance.file_scan_jobs').ifExists().execute();
  await db.schema
    .dropTable('compliance.submission_events')
    .ifExists()
    .execute();
  await db.schema
    .dropTable('compliance.team_clearance_projections')
    .ifExists()
    .execute();
  await db.schema.dropTable('compliance.submission_files').ifExists().execute();
  await db.schema
    .alterTable('compliance.team_submissions')
    .dropConstraint('compliance_team_submissions_current_attempt_fk')
    .execute();
  await db.schema
    .dropTable('compliance.submission_attempts')
    .ifExists()
    .execute();
  await db.schema.dropTable('compliance.team_submissions').ifExists().execute();
  await db.schema.dropTable('compliance.requirements').ifExists().execute();
  await db.schema
    .dropTable('compliance.division_settings')
    .ifExists()
    .execute();
  await sql`
		drop function if exists compliance.prevent_submission_attempt_mutation()
	`.execute(db);
  await db.schema.dropSchema('compliance').ifExists().execute();
}
