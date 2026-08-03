import type { Kysely } from 'kysely'
import { sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists public_portal.league_shells`.execute(db)

	await db.schema
		.createTable('admin.division_roster_settings')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('division_id', 'uuid', (column) =>
			column.notNull().references('admin.divisions.id').onDelete('cascade'),
		)
		.addColumn('min_active_players', 'integer')
		.addColumn('max_active_players', 'integer')
		.addColumn('submission_deadline_at', 'timestamptz')
		.addColumn('released_at', 'timestamptz')
		.addColumn('release_reason', 'varchar(40)')
		.addColumn('released_by_member_id', 'uuid', (column) =>
			column.references('admin.organization_members.id').onDelete('set null'),
		)
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('division_roster_settings_division_unique', [
			'division_id',
		])
		.execute()

	await db.schema
		.createTable('admin.team_rosters')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('team_id', 'uuid', (column) =>
			column.notNull().references('admin.teams.id').onDelete('cascade'),
		)
		.addColumn('workflow_status', 'varchar(40)', (column) =>
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
		.addColumn('amendment_reason', 'text')
		.addColumn('latest_approved_version_id', 'uuid')
		.addColumn('published_version_id', 'uuid')
		.addColumn('published_at', 'timestamptz')
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('updated_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('team_rosters_team_unique', ['team_id'])
		.execute()

	await db.schema
		.createTable('admin.roster_versions')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('team_roster_id', 'uuid', (column) =>
			column.notNull().references('admin.team_rosters.id').onDelete('cascade'),
		)
		.addColumn('version_number', 'integer', (column) => column.notNull())
		.addColumn('approved_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addColumn('approved_by_member_id', 'uuid', (column) =>
			column.references('admin.organization_members.id').onDelete('set null'),
		)
		.addColumn('amendment_reason', 'text')
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('roster_versions_roster_version_unique', [
			'team_roster_id',
			'version_number',
		])
		.execute()

	await db.schema
		.createTable('admin.roster_version_players')
		.addColumn('id', 'uuid', (column) =>
			column.primaryKey().defaultTo(db.fn('gen_random_uuid')),
		)
		.addColumn('roster_version_id', 'uuid', (column) =>
			column
				.notNull()
				.references('admin.roster_versions.id')
				.onDelete('cascade'),
		)
		.addColumn('source_player_id', 'uuid', (column) =>
			column.references('admin.players.id').onDelete('set null'),
		)
		.addColumn('name', 'varchar(160)', (column) => column.notNull())
		.addColumn('jersey_number', 'varchar(20)', (column) => column.notNull())
		.addColumn('position', 'varchar(80)')
		.addColumn('sort_order', 'integer', (column) => column.notNull())
		.addColumn('created_at', 'timestamptz', (column) =>
			column.notNull().defaultTo(db.fn('now')),
		)
		.addUniqueConstraint('roster_version_players_jersey_unique', [
			'roster_version_id',
			'jersey_number',
		])
		.execute()

	await db.schema
		.createIndex('division_roster_settings_division_id_index')
		.on('admin.division_roster_settings')
		.column('division_id')
		.execute()
	await db.schema
		.createIndex('team_rosters_team_id_index')
		.on('admin.team_rosters')
		.column('team_id')
		.execute()
	await db.schema
		.createIndex('roster_versions_team_roster_id_index')
		.on('admin.roster_versions')
		.column('team_roster_id')
		.execute()
	await db.schema
		.createIndex('roster_version_players_version_id_index')
		.on('admin.roster_version_players')
		.column('roster_version_id')
		.execute()

	await sql`
		alter table admin.team_rosters
		add constraint team_rosters_latest_approved_version_fk
		foreign key (latest_approved_version_id)
		references admin.roster_versions(id)
		on delete set null
	`.execute(db)
	await sql`
		alter table admin.team_rosters
		add constraint team_rosters_published_version_fk
		foreign key (published_version_id)
		references admin.roster_versions(id)
		on delete set null
	`.execute(db)
	await sql`
		alter table admin.division_roster_settings
		add constraint division_roster_settings_min_check
		check (min_active_players is null or min_active_players >= 0)
	`.execute(db)
	await sql`
		alter table admin.division_roster_settings
		add constraint division_roster_settings_max_check
		check (max_active_players is null or max_active_players >= 1)
	`.execute(db)
	await sql`
		alter table admin.division_roster_settings
		add constraint division_roster_settings_range_check
		check (
			min_active_players is null
			or max_active_players is null
			or min_active_players <= max_active_players
		)
	`.execute(db)

	await sql`
		insert into admin.division_roster_settings (
			division_id,
			released_at,
			release_reason
		)
		select
			d.id,
			case when ls.public_enabled = true then now() else null end,
			case when ls.public_enabled = true then 'grandfathered' else null end
		from admin.divisions d
		inner join admin.league_seasons ls
			on ls.id = d.league_season_id
		on conflict (division_id) do nothing
	`.execute(db)

	await sql`
		insert into admin.team_rosters (
			team_id,
			workflow_status,
			reviewed_at,
			published_at
		)
		select
			t.id,
			case when ls.public_enabled = true and t.status = 'active' then 'approved' else 'draft' end,
			case when ls.public_enabled = true and t.status = 'active' then now() else null end,
			case when ls.public_enabled = true and t.status = 'active' then now() else null end
		from admin.teams t
		inner join admin.divisions d
			on d.id = t.division_id
		inner join admin.league_seasons ls
			on ls.id = d.league_season_id
		on conflict (team_id) do nothing
	`.execute(db)

	await sql`
		insert into admin.roster_versions (
			team_roster_id,
			version_number,
			approved_at,
			amendment_reason
		)
		select
			tr.id,
			1,
			now(),
			'Grandfathered from existing public roster'
		from admin.team_rosters tr
		inner join admin.teams t
			on t.id = tr.team_id
		inner join admin.divisions d
			on d.id = t.division_id
		inner join admin.league_seasons ls
			on ls.id = d.league_season_id
		where ls.public_enabled = true
			and t.status = 'active'
		on conflict (team_roster_id, version_number) do nothing
	`.execute(db)

	await sql`
		insert into admin.roster_version_players (
			roster_version_id,
			source_player_id,
			name,
			jersey_number,
			position,
			sort_order
		)
		select
			rv.id,
			p.id,
			p.name,
			p.jersey_number,
			p.position,
			row_number() over (
				partition by rv.id
				order by p.jersey_number, p.name, p.id
			)
		from admin.roster_versions rv
		inner join admin.team_rosters tr
			on tr.id = rv.team_roster_id
		inner join admin.players p
			on p.team_id = tr.team_id
			and p.status = 'active'
		where rv.version_number = 1
	`.execute(db)

	await sql`
		update admin.team_rosters tr
		set
			latest_approved_version_id = rv.id,
			published_version_id = rv.id,
			updated_at = now()
		from admin.roster_versions rv
		where rv.team_roster_id = tr.id
			and rv.version_number = 1
	`.execute(db)

	await sql`
		create view public_portal.league_shells as
		select
			o.id as organization_id,
			o.name as organization_name,
			o.slug as organization_slug,
			ls.id as season_id,
			ls.name as season_name,
			ls.slug as season_slug,
			d.id as division_id,
			d.name as division_name,
			d.slug as division_slug,
			t.id as team_id,
			t.name as team_name,
			t.slug as team_slug,
			t.color as team_color,
			rvp.id as player_id,
			rvp.name as player_name,
			rvp.jersey_number as player_jersey_number
		from admin.organizations o
		inner join admin.league_seasons ls
			on ls.organization_id = o.id
		left join admin.divisions d
			on d.league_season_id = ls.id
			and d.status = 'active'
		left join admin.teams t
			on t.division_id = d.id
			and t.status = 'active'
		left join admin.team_rosters tr
			on tr.team_id = t.id
			and tr.published_version_id is not null
		left join admin.roster_version_players rvp
			on rvp.roster_version_id = tr.published_version_id
		where ls.public_enabled = true
	`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
	await sql`drop view if exists public_portal.league_shells`.execute(db)
	await sql`
		create view public_portal.league_shells as
		select
			o.id as organization_id,
			o.name as organization_name,
			o.slug as organization_slug,
			ls.id as season_id,
			ls.name as season_name,
			ls.slug as season_slug,
			d.id as division_id,
			d.name as division_name,
			d.slug as division_slug,
			t.id as team_id,
			t.name as team_name,
			t.slug as team_slug,
			t.color as team_color,
			p.id as player_id,
			p.name as player_name,
			p.jersey_number as player_jersey_number
		from admin.organizations o
		inner join admin.league_seasons ls
			on ls.organization_id = o.id
		left join admin.divisions d
			on d.league_season_id = ls.id
			and d.status = 'active'
		left join admin.teams t
			on t.division_id = d.id
			and t.status = 'active'
		left join admin.players p
			on p.team_id = t.id
			and p.status = 'active'
		where ls.public_enabled = true
	`.execute(db)

	await sql`
		alter table admin.team_rosters
		drop constraint if exists team_rosters_published_version_fk
	`.execute(db)
	await sql`
		alter table admin.team_rosters
		drop constraint if exists team_rosters_latest_approved_version_fk
	`.execute(db)
	await db.schema
		.dropTable('admin.roster_version_players')
		.ifExists()
		.execute()
	await db.schema.dropTable('admin.roster_versions').ifExists().execute()
	await db.schema.dropTable('admin.team_rosters').ifExists().execute()
	await db.schema
		.dropTable('admin.division_roster_settings')
		.ifExists()
		.execute()
}
