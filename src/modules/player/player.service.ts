import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';

@Injectable()
export class PlayerService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(organizationId: string, createPlayerDto: CreatePlayerDto) {
    await this.assertTeamBelongsToOrganization(
      organizationId,
      createPlayerDto.teamId,
    );
    await this.ensureJerseyAvailable(
      createPlayerDto.teamId,
      createPlayerDto.jerseyNumber,
    );

    return this.db
      .insertInto('admin.players')
      .values({
        jersey_number: createPlayerDto.jerseyNumber,
        name: createPlayerDto.name,
        status: createPlayerDto.status ?? 'active',
        team_id: createPlayerDto.teamId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findAll(organizationId: string) {
    return this.db
      .selectFrom('admin.players as players')
      .innerJoin('admin.teams as teams', 'teams.id', 'players.team_id')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'players.created_at',
        'players.id',
        'players.jersey_number',
        'players.name',
        'players.status',
        'players.team_id',
        'players.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId)
      .orderBy('players.created_at asc')
      .execute();
  }

  async findOne(organizationId: string, playerId: string) {
    const player = await this.db
      .selectFrom('admin.players as players')
      .innerJoin('admin.teams as teams', 'teams.id', 'players.team_id')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select([
        'players.created_at',
        'players.id',
        'players.jersey_number',
        'players.name',
        'players.status',
        'players.team_id',
        'players.updated_at',
      ])
      .where('players.id', '=', playerId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    return player;
  }

  async update(
    organizationId: string,
    playerId: string,
    updatePlayerDto: UpdatePlayerDto,
  ) {
    const player = await this.findOne(organizationId, playerId);

    if (
      updatePlayerDto.jerseyNumber &&
      updatePlayerDto.jerseyNumber !== player.jersey_number
    ) {
      await this.ensureJerseyAvailable(
        player.team_id,
        updatePlayerDto.jerseyNumber,
      );
    }

    return this.db
      .updateTable('admin.players')
      .set({
        jersey_number: updatePlayerDto.jerseyNumber,
        name: updatePlayerDto.name,
        status: updatePlayerDto.status,
        updated_at: new Date(),
      })
      .where('id', '=', playerId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(organizationId: string, playerId: string) {
    await this.findOne(organizationId, playerId);

    await this.db.deleteFrom('admin.players').where('id', '=', playerId).execute();

    return { success: true };
  }

  private async assertTeamBelongsToOrganization(
    organizationId: string,
    teamId: string,
  ): Promise<void> {
    const team = await this.db
      .selectFrom('admin.teams as teams')
      .innerJoin('admin.divisions as divisions', 'divisions.id', 'teams.division_id')
      .innerJoin(
        'admin.league_seasons as league_seasons',
        'league_seasons.id',
        'divisions.league_season_id',
      )
      .select(['teams.id'])
      .where('teams.id', '=', teamId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found in this organization');
    }
  }

  private async ensureJerseyAvailable(
    teamId: string,
    jerseyNumber: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('admin.players')
      .select(['id'])
      .where('team_id', '=', teamId)
      .where('jersey_number', '=', jerseyNumber)
      .executeTakeFirst();

    if (existing) {
      throw new ConflictException('Jersey number already exists for this team');
    }
  }
}
