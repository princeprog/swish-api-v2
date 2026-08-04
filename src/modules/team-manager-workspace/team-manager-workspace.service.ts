import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';

type AssignmentRow = {
  assignment_id: string;
  division_id: string;
  division_name: string;
  division_slug: string;
  league_season_id: string;
  league_season_name: string;
  league_season_slug: string;
  league_season_status: string;
  roster_amendment_reason: string | null;
  roster_published_version_id: string | null;
  roster_return_reason: string | null;
  roster_status: string | null;
  roster_submission_deadline_at: Date | null;
  team_color: string | null;
  team_id: string;
  team_name: string;
  team_slug: string;
  team_status: string;
};

@Injectable()
export class TeamManagerWorkspaceService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getWorkspace(organizationId: string, access: OrganizationAccessContext) {
    const rows = (await this.db
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin('admin.teams as teams', 'teams.id', 'assignments.team_id')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'assignments.league_season_id',
      )
      .leftJoin(
        'admin.team_rosters as rosters',
        'rosters.team_id',
        'teams.id',
      )
      .leftJoin(
        'admin.division_roster_settings as roster_settings',
        'roster_settings.division_id',
        'divisions.id',
      )
      .select([
        'assignments.id as assignment_id',
        'divisions.id as division_id',
        'divisions.name as division_name',
        'divisions.slug as division_slug',
        'league_seasons.id as league_season_id',
        'league_seasons.name as league_season_name',
        'league_seasons.slug as league_season_slug',
        'league_seasons.status as league_season_status',
        'rosters.amendment_reason as roster_amendment_reason',
        'rosters.published_version_id as roster_published_version_id',
        'rosters.review_note as roster_return_reason',
        'rosters.workflow_status as roster_status',
        'roster_settings.submission_deadline_at as roster_submission_deadline_at',
        'teams.color as team_color',
        'teams.id as team_id',
        'teams.name as team_name',
        'teams.slug as team_slug',
        'teams.status as team_status',
      ])
      .where('assignments.organization_member_id', '=', access.membershipId)
      .where('league_seasons.organization_id', '=', organizationId)
      .orderBy('league_seasons.status asc')
      .orderBy('league_seasons.created_at desc')
      .execute()) as AssignmentRow[];

    const assignments = rows.map((row) => ({
      assignmentId: row.assignment_id,
      division: {
        id: row.division_id,
        name: row.division_name,
        slug: row.division_slug,
      },
      roster: {
        amendmentReason: row.roster_amendment_reason,
        publishedVersionId: row.roster_published_version_id,
        reviewNote: row.roster_return_reason,
        status: row.roster_status ?? 'draft',
        submissionDeadlineAt:
          row.roster_submission_deadline_at?.toISOString() ?? null,
      },
      season: {
        id: row.league_season_id,
        name: row.league_season_name,
        slug: row.league_season_slug,
        status: row.league_season_status,
      },
      team: {
        color: row.team_color,
        id: row.team_id,
        name: row.team_name,
        slug: row.team_slug,
        status: row.team_status,
      },
    }));

    const defaultAssignment =
      assignments.find((assignment) => assignment.season.status === 'active') ??
      assignments[0] ??
      null;

    return {
      assignments,
      defaultSeasonId: defaultAssignment?.season.id ?? null,
    };
  }
}
