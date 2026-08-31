import { Inject, Injectable } from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { StandingsQueryDto } from './dto/standings-query.dto';

type StandingsProjectionRow = {
  games_played: number;
  losses: number;
  point_differential: number;
  points_against: number;
  points_for: number;
  qualification_status: string;
  rank: number | null;
  ranking_explanation: unknown;
  team_id: string;
  unresolved_tie_key: string | null;
  win_percentage: number | string;
  wins: number;
  team_color: string | null;
  team_name: string;
  division_id: string;
  division_name: string;
  pool_code: string;
  pool_name: string;
};

function mapProjection(row: StandingsProjectionRow) {
  return {
    divisionId: row.division_id,
    divisionName: row.division_name,
    gamesPlayed: Number(row.games_played),
    losses: Number(row.losses),
    pointDifferential: Number(row.point_differential),
    pointsAgainst: Number(row.points_against),
    pointsFor: Number(row.points_for),
    rank: row.rank === null ? null : Number(row.rank),
    recentResults: [] as Array<'W' | 'L'>,
    teamColor: row.team_color,
    teamId: row.team_id,
    teamName: row.team_name,
    winPercentage: Number(row.win_percentage),
    wins: Number(row.wins),
    qualificationStatus: row.qualification_status,
    rankingExplanation: Array.isArray(row.ranking_explanation)
      ? row.ranking_explanation
      : [],
    unresolvedTieKey: row.unresolved_tie_key,
    poolCode: row.pool_code,
    poolName: row.pool_name,
  };
}

@Injectable()
export class StandingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll(
    organizationId: string,
    accessOrQuery: OrganizationAccessContext | StandingsQueryDto,
    maybeQuery?: StandingsQueryDto,
  ) {
    const access = 'membershipId' in accessOrQuery ? accessOrQuery : undefined;
    const query = 'membershipId' in accessOrQuery ? maybeQuery : accessOrQuery;

    if (!query) {
      throw new Error('Standings query is required');
    }

    let standingsQuery = (this.db as any)
      .selectFrom('competition.standings_projections as standings')
      .innerJoin(
        'competition.division_formats as formats',
        'formats.id',
        'standings.division_format_id',
      )
      .innerJoin('competition.pools as pools', 'pools.id', 'standings.pool_id')
      .innerJoin('admin.teams as teams', 'teams.id', 'standings.team_id')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'formats.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'standings.games_played',
        'standings.losses',
        'standings.point_differential',
        'standings.points_against',
        'standings.points_for',
        'standings.qualification_status',
        'standings.rank',
        'standings.ranking_explanation',
        'standings.team_id',
        'standings.unresolved_tie_key',
        'standings.win_percentage',
        'standings.wins',
        'teams.color as team_color',
        'teams.name as team_name',
        'divisions.id as division_id',
        'divisions.name as division_name',
        'pools.code as pool_code',
        'pools.name as pool_name',
      ])
      .where('seasons.organization_id', '=', organizationId)
      .where('seasons.id', '=', query.leagueSeasonId)
      .where('formats.status', 'in', ['locked', 'completed'])
      .where('teams.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
      .where('seasons.archived_at', 'is', null)
      .orderBy('divisions.name asc')
      .orderBy('pools.sort_order asc')
      .orderBy('standings.rank asc')
      .orderBy('teams.name asc');

    if (query.divisionId) {
      standingsQuery = standingsQuery.where(
        'divisions.id',
        '=',
        query.divisionId,
      );
    }

    if (
      access &&
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.STANDINGS_READ_ASSIGNED_DIVISION,
      ) &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.STANDINGS_READ)
    ) {
      standingsQuery = standingsQuery.where((eb: any) =>
        eb.exists(
          eb
            .selectFrom('access.team_manager_assignments as assigned_teams')
            .innerJoin(
              'admin.teams as assigned_team_records',
              'assigned_team_records.id',
              'assigned_teams.team_id',
            )
            .select('assigned_teams.id')
            .where(
              'assigned_teams.organization_member_id',
              '=',
              access.membershipId,
            )
            .where('assigned_team_records.archived_at', 'is', null)
            .whereRef(
              'assigned_team_records.division_id',
              '=',
              'divisions.id',
            ),
        ),
      );
    }

    const projections = (await standingsQuery.execute()) as StandingsProjectionRow[];
    const rows = projections.map(mapProjection);
    const finalizedGamesCount = Math.floor(
      rows.reduce((total, row) => total + row.gamesPlayed, 0) / 2,
    );

    return { finalizedGamesCount, rows };
  }
}
