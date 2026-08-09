import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTH_ROLES,
  type AuthRole,
} from '../../common/auth/roles';
import { DATABASE, type Database } from '../../database/database.tokens';

export type AssignableTeam = {
  id: string;
  league_season_id: string;
  league_season_name: string;
  name: string;
  slug: string;
};

export function assertUniqueTeamIds(teamIds: string[]): void {
  if (new Set(teamIds).size !== teamIds.length) {
    throw new BadRequestException('Each team can only be selected once.');
  }
}

export function assertOneTeamPerSeason(
  teams: Array<Pick<AssignableTeam, 'id' | 'league_season_id'>>,
): void {
  const selectedSeasonIds = new Set<string>();

  for (const team of teams) {
    if (selectedSeasonIds.has(team.league_season_id)) {
      throw new BadRequestException(
        'A team manager can only manage one team in each season.',
      );
    }

    selectedSeasonIds.add(team.league_season_id);
  }
}

@Injectable()
export class TeamAssignmentPolicyService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolve(
    organizationId: string,
    role: AuthRole | string,
    teamIds: string[],
  ): Promise<AssignableTeam[]> {
    assertUniqueTeamIds(teamIds);

    if (role !== AUTH_ROLES.TEAM_MANAGER && teamIds.length) {
      throw new BadRequestException(
        'Only team managers can receive team assignments.',
      );
    }

    const teams = await this.findAssignableTeams(organizationId, teamIds);
    assertOneTeamPerSeason(teams);
    return teams;
  }

  async findAssignableTeams(
    organizationId: string,
    teamIds: string[],
  ): Promise<AssignableTeam[]> {
    if (!teamIds.length) {
      return [];
    }

    const rows = await this.db
      .selectFrom('admin.teams as teams')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'teams.division_id',
      )
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'teams.id',
        'teams.name',
        'teams.slug',
        'divisions.league_season_id',
        'league_seasons.name as league_season_name',
      ])
      .where('teams.id', 'in', teamIds)
      .where('league_seasons.organization_id', '=', organizationId)
      .execute();

    if (rows.length !== teamIds.length) {
      throw new NotFoundException('One or more teams were not found');
    }

    return rows;
  }
}
