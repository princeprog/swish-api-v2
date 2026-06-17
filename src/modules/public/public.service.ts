import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';

type PublicOrganizationSeason = {
  id: string;
  name: string;
  slug: string;
};

type PublicOrganization = {
  id: string;
  name: string;
  seasons: PublicOrganizationSeason[];
  slug: string;
};

type PublicPlayer = {
  id: string;
  jerseyNumber: string;
  name: string;
};

type PublicTeam = {
  color: string | null;
  id: string;
  name: string;
  players: PublicPlayer[];
  slug: string;
};

type PublicDivision = {
  id: string;
  name: string;
  slug: string;
  teams: PublicTeam[];
};

type PublicLeagueShell = {
  divisions: PublicDivision[];
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  season: {
    id: string;
    name: string;
    slug: string;
  };
};

@Injectable()
export class PublicService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getOrganization(organizationSlug: string): Promise<PublicOrganization> {
    const rows = await (this.db as any)
      .selectFrom('public_portal.organizations')
      .selectAll()
      .where('organization_slug', '=', organizationSlug)
      .orderBy('season_name asc')
      .execute();

    if (rows.length === 0) {
      throw new NotFoundException('Public organization not found');
    }

    const [first] = rows;

    return {
      id: first.organization_id,
      name: first.organization_name,
      seasons: rows.map((row: any) => ({
        id: row.season_id,
        name: row.season_name,
        slug: row.season_slug,
      })),
      slug: first.organization_slug,
    };
  }

  async getLeagueShell(
    organizationSlug: string,
    seasonSlug: string,
  ): Promise<PublicLeagueShell> {
    const rows = await (this.db as any)
      .selectFrom('public_portal.league_shells')
      .selectAll()
      .where('organization_slug', '=', organizationSlug)
      .where('season_slug', '=', seasonSlug)
      .orderBy('division_name asc')
      .orderBy('team_name asc')
      .orderBy('player_name asc')
      .execute();

    if (rows.length === 0) {
      throw new NotFoundException('Public league shell not found');
    }

    const [first] = rows;
    const divisions = new Map<string, PublicDivision>();

    for (const row of rows) {
      if (!row.division_id) {
        continue;
      }

      let division = divisions.get(row.division_id);
      if (!division) {
        division = {
          id: row.division_id,
          name: row.division_name,
          slug: row.division_slug,
          teams: [],
        };
        divisions.set(row.division_id, division);
      }

      if (!row.team_id) {
        continue;
      }

      let team = division.teams.find((item) => item.id === row.team_id);
      if (!team) {
        team = {
          color: row.team_color,
          id: row.team_id,
          name: row.team_name,
          players: [],
          slug: row.team_slug,
        };
        division.teams.push(team);
      }

      if (!row.player_id) {
        continue;
      }

      team.players.push({
        id: row.player_id,
        jerseyNumber: row.player_jersey_number,
        name: row.player_name,
      });
    }

    return {
      divisions: Array.from(divisions.values()),
      organization: {
        id: first.organization_id,
        name: first.organization_name,
        slug: first.organization_slug,
      },
      season: {
        id: first.season_id,
        name: first.season_name,
        slug: first.season_slug,
      },
    };
  }
}
