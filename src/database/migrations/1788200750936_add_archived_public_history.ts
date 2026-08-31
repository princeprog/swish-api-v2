import type { Kysely } from 'kysely'
import { sql } from 'kysely'

async function recreatePublicViews(
  db: Kysely<any>,
  excludeArchivedRecords: boolean,
): Promise<void> {

  const organizationFilters = excludeArchivedRecords
    ? sql`and o.archived_at is null and ls.archived_at is null`
    : sql``
  const divisionFilter = excludeArchivedRecords
    ? sql`and d.archived_at is null`
    : sql``
  const teamFilter = excludeArchivedRecords
    ? sql`and t.archived_at is null`
    : sql``

  await sql`drop view if exists public_portal.league_shells`.execute(db)
  await sql`drop view if exists public_portal.organizations`.execute(db)
  await db.schema.createSchema('public_portal').ifNotExists().execute()

  await sql`
    create view public_portal.organizations as
    select
      o.id as organization_id,
      o.name as organization_name,
      o.slug as organization_slug,
      ls.id as season_id,
      ls.name as season_name,
      ls.slug as season_slug
    from admin.organizations o
    inner join admin.league_seasons ls
      on ls.organization_id = o.id
    where ls.public_enabled = true
      ${organizationFilters}
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
      ${divisionFilter}
    left join admin.teams t
      on t.division_id = d.id
      and t.status = 'active'
      ${teamFilter}
    left join admin.team_rosters tr
      on tr.team_id = t.id
      and tr.published_version_id is not null
    left join admin.roster_version_players rvp
      on rvp.roster_version_id = tr.published_version_id
    where ls.public_enabled = true
      ${organizationFilters}
  `.execute(db)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function up(db: Kysely<any>): Promise<void> {
  await recreatePublicViews(db, true)
}

// `any` is required here since migrations should be frozen in time. alternatively, keep a "snapshot" db interface.
export async function down(db: Kysely<any>): Promise<void> {
  await recreatePublicViews(db, false)
}
