import { sql, type Kysely } from 'kysely';

async function createScheduleGamesView(
  db: Kysely<any>,
  includeStatistician: boolean,
) {
  const statisticianColumns = includeStatistician
    ? sql`
        statistician_assignments.organization_member_id as statistician_member_id,
        statistician_users.name as statistician_name,
      `
    : sql``;
  const statisticianJoins = includeStatistician
    ? sql`
        left join access.game_statistician_assignments statistician_assignments
          on statistician_assignments.game_id = g.id
        left join admin.organization_members statistician_members
          on statistician_members.id = statistician_assignments.organization_member_id
        left join auth.users statistician_users
          on statistician_users.id = statistician_members.user_id
      `
    : sql``;

  await sql`
    create view admin.schedule_games as
    select
      g.id,
      ls.organization_id,
      g.league_season_id,
      ls.name as league_season_name,
      ls.slug as league_season_slug,
      g.division_id,
      d.name as division_name,
      d.slug as division_slug,
      g.venue_id,
      v.name as venue_name,
      v.slug as venue_slug,
      g.home_team_id,
      ht.name as home_team_name,
      ht.slug as home_team_slug,
      ht.color as home_team_color,
      g.away_team_id,
      at.name as away_team_name,
      at.slug as away_team_slug,
      at.color as away_team_color,
      scorekeeper_assignments.organization_member_id as scorekeeper_member_id,
      scorekeeper_users.name as scorekeeper_name,
      ${statisticianColumns}
      g.home_score,
      g.away_score,
      g.finalized_at,
      g.matchup_id,
      g.competition_kind,
      g.starts_at,
      g.status,
      g.published_at,
      g.created_at,
      g.updated_at
    from competition.games g
    inner join admin.league_seasons ls
      on ls.id = g.league_season_id
    inner join admin.divisions d
      on d.id = g.division_id
    inner join admin.venues v
      on v.id = g.venue_id
    inner join admin.teams ht
      on ht.id = g.home_team_id
    inner join admin.teams at
      on at.id = g.away_team_id
    left join access.game_scorekeeper_assignments scorekeeper_assignments
      on scorekeeper_assignments.game_id = g.id
    left join admin.organization_members scorekeeper_members
      on scorekeeper_members.id = scorekeeper_assignments.organization_member_id
    left join auth.users scorekeeper_users
      on scorekeeper_users.id = scorekeeper_members.user_id
    ${statisticianJoins}
  `.execute(db);
}

export async function up(db: Kysely<any>): Promise<void> {
  await sql`drop view if exists admin.schedule_games`.execute(db);
  await createScheduleGamesView(db, true);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`drop view if exists admin.schedule_games`.execute(db);
  await createScheduleGamesView(db, false);
}
