import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { calculateStandings } from './standings-calculator';
import type { StandingsQueryDto } from './dto/standings-query.dto';
import type { FinalizedGameResult, StandingsTeam } from './standings.types';

@Injectable()
export class StandingsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAll(organizationId: string, query: StandingsQueryDto) {
    let teamsQuery = this.db
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
        'teams.color',
        'teams.id',
        'teams.name',
        'divisions.id as division_id',
        'divisions.name as division_name',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .where('divisions.league_season_id', '=', query.leagueSeasonId)
      .where('teams.status', '=', 'active')
      .orderBy('divisions.name asc')
      .orderBy('teams.name asc');

    let resultsQuery = this.db
      .selectFrom('competition.finalized_game_results as results')
      .select([
        'results.away_score',
        'results.away_team_id',
        'results.division_id',
        'results.home_score',
        'results.home_team_id',
        'results.id',
      ])
      .where('results.organization_id', '=', organizationId)
      .where('results.league_season_id', '=', query.leagueSeasonId);

    if (query.divisionId) {
      teamsQuery = teamsQuery.where('teams.division_id', '=', query.divisionId);
      resultsQuery = resultsQuery.where(
        'results.division_id',
        '=',
        query.divisionId,
      );
    }

    const [teams, finalizedResults] = await Promise.all([
      teamsQuery.execute() as Promise<StandingsTeam[]>,
      resultsQuery.execute() as Promise<FinalizedGameResult[]>,
    ]);

    return {
      finalizedGamesCount: finalizedResults.length,
      rows: calculateStandings(teams, finalizedResults),
    };
  }
}
