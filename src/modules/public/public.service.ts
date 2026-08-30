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

  async getLeaguePortal(organizationSlug: string, seasonSlug: string) {
    const shell = await this.getLeagueShell(organizationSlug, seasonSlug);
    const season = await this.db
      .selectFrom('admin.league_seasons as seasons')
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'seasons.organization_id',
      )
      .select('seasons.id')
      .where('organizations.slug', '=', organizationSlug)
      .where('seasons.slug', '=', seasonSlug)
      .where('seasons.public_enabled', '=', true)
      .executeTakeFirst();
    if (!season) throw new NotFoundException('Public league not found');

    const [games, standings, bracket, leaders, awards] = await Promise.all([
      (this.db as any)
        .selectFrom('competition.games as games')
        .innerJoin('admin.divisions as divisions', 'divisions.id', 'games.division_id')
        .innerJoin('admin.teams as homeTeams', 'homeTeams.id', 'games.home_team_id')
        .innerJoin('admin.teams as awayTeams', 'awayTeams.id', 'games.away_team_id')
        .innerJoin('admin.venues as venues', 'venues.id', 'games.venue_id')
        .select([
          'games.id',
          'games.starts_at',
          'games.status',
          'games.home_score',
          'games.away_score',
          'games.competition_kind',
          'divisions.id as division_id',
          'divisions.name as division_name',
          'homeTeams.id as home_team_id',
          'homeTeams.name as home_team_name',
          'awayTeams.id as away_team_id',
          'awayTeams.name as away_team_name',
          'venues.name as venue_name',
        ])
        .where('games.league_season_id', '=', season.id)
        .where('games.published_at', 'is not', null)
        .where('games.status', 'in', ['scheduled', 'live', 'final', 'reopened'])
        .orderBy('games.starts_at asc')
        .execute(),
      (this.db as any)
        .selectFrom('competition.standings_projections as standings')
        .innerJoin('competition.pools as pools', 'pools.id', 'standings.pool_id')
        .innerJoin(
          'competition.division_formats as formats',
          'formats.id',
          'standings.division_format_id',
        )
        .innerJoin('admin.divisions as divisions', 'divisions.id', 'formats.division_id')
        .innerJoin('admin.teams as teams', 'teams.id', 'standings.team_id')
        .select([
          'divisions.id as division_id',
          'divisions.name as division_name',
          'pools.code as pool_code',
          'pools.name as pool_name',
          'teams.id as team_id',
          'teams.name as team_name',
          'standings.games_played',
          'standings.wins',
          'standings.losses',
          'standings.points_for',
          'standings.points_against',
          'standings.point_differential',
          'standings.win_percentage',
          'standings.rank',
          'standings.qualification_status',
          'standings.ranking_explanation',
        ])
        .where('divisions.league_season_id', '=', season.id)
        .orderBy('divisions.name asc')
        .orderBy('pools.sort_order asc')
        .orderBy('standings.rank asc')
        .execute(),
      (this.db as any)
        .selectFrom('competition.matchups as matchups')
        .innerJoin(
          'competition.division_formats as formats',
          'formats.id',
          'matchups.division_format_id',
        )
        .innerJoin('admin.divisions as divisions', 'divisions.id', 'formats.division_id')
        .leftJoin('admin.teams as homeTeams', 'homeTeams.id', 'matchups.home_team_id')
        .leftJoin('admin.teams as awayTeams', 'awayTeams.id', 'matchups.away_team_id')
        .leftJoin('admin.teams as winnerTeams', 'winnerTeams.id', 'matchups.winner_team_id')
        .select([
          'matchups.id',
          'matchups.stage',
          'matchups.bracket_side',
          'matchups.round_number',
          'matchups.position',
          'matchups.label',
          'matchups.status',
          'matchups.is_reset_final',
          'matchups.winner_to_matchup_id',
          'matchups.winner_to_slot',
          'matchups.loser_to_matchup_id',
          'matchups.loser_to_slot',
          'homeTeams.id as home_team_id',
          'homeTeams.name as home_team_name',
          'awayTeams.id as away_team_id',
          'awayTeams.name as away_team_name',
          'winnerTeams.id as winner_team_id',
          'winnerTeams.name as winner_team_name',
          'divisions.id as division_id',
          'divisions.name as division_name',
        ])
        .where('divisions.league_season_id', '=', season.id)
        .where('matchups.stage', '=', 'playoff')
        .orderBy('divisions.name asc')
        .orderBy('matchups.bracket_side asc')
        .orderBy('matchups.round_number asc')
        .orderBy('matchups.position asc')
        .execute(),
      (this.db as any)
        .selectFrom('statistics.player_box_scores as boxScores')
        .innerJoin('competition.games as games', 'games.id', 'boxScores.game_id')
        .innerJoin(
          'scoring.game_roster_players as players',
          'players.id',
          'boxScores.game_roster_player_id',
        )
        .innerJoin('admin.teams as teams', 'teams.id', 'boxScores.team_id')
        .select([
          'players.source_player_id as player_id',
          'players.name as player_name',
          'teams.id as team_id',
          'teams.name as team_name',
        ])
        .select((eb: any) => [
          eb.fn.sum('boxScores.points').as('points'),
          eb.fn.sum('boxScores.rebounds').as('rebounds'),
          eb.fn.sum('boxScores.assists').as('assists'),
          eb.fn.sum('boxScores.steals').as('steals'),
          eb.fn.sum('boxScores.turnovers').as('turnovers'),
        ])
        .where('games.league_season_id', '=', season.id)
        .where('games.status', '=', 'final')
        .groupBy([
          'players.source_player_id',
          'players.name',
          'teams.id',
          'teams.name',
        ])
        .orderBy('points desc')
        .orderBy('player_name asc')
        .execute(),
      (this.db as any)
        .selectFrom('statistics.game_awards as awards')
        .innerJoin('competition.games as games', 'games.id', 'awards.game_id')
        .innerJoin(
          'scoring.game_roster_players as players',
          'players.id',
          'awards.selected_player_id',
        )
        .innerJoin(
          'scoring.game_roster_snapshots as snapshots',
          'snapshots.id',
          'players.game_roster_snapshot_id',
        )
        .innerJoin('admin.teams as teams', 'teams.id', 'snapshots.team_id')
        .select([
          'games.id as game_id',
          'players.source_player_id as player_id',
          'players.name as player_name',
          'teams.id as team_id',
          'teams.name as team_name',
          'awards.confirmed_at',
        ])
        .where('games.league_season_id', '=', season.id)
        .where('awards.confirmed_at', 'is not', null)
        .orderBy('games.starts_at desc')
        .execute(),
    ]);

    const publicGames = games.map((game: any) => ({
      awayScore: game.away_score,
      awayTeam: { id: game.away_team_id, name: game.away_team_name },
      competitionKind: game.competition_kind,
      division: { id: game.division_id, name: game.division_name },
      homeScore: game.home_score,
      homeTeam: { id: game.home_team_id, name: game.home_team_name },
      id: game.id,
      liveScoreIsUnofficial: game.status === 'live' || game.status === 'reopened',
      startsAt: game.starts_at,
      status: game.status,
      venueName: game.venue_name,
    }));

    return {
      ...shell,
      awards,
      bracket,
      leaders,
      results: publicGames.filter((game: any) => game.status === 'final'),
      schedule: publicGames.filter((game: any) => game.status !== 'final'),
      standings,
    };
  }
}
