import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ORGANIZATION_PERMISSIONS,
  type OrganizationAccessContext,
} from '../../common/auth/roles';
import {
  createPaginatedResponse,
  normalizePagination,
} from '../../common/pagination/pagination.types';
import { DATABASE, type Database } from '../../database/database.tokens';
import { RosterService } from '../roster/roster.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import type { PlayerListQueryDto } from './dto/player-list-query.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';

@Injectable()
export class PlayerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly rosterService: RosterService,
  ) {}

  async create(
    organizationId: string,
    access: OrganizationAccessContext,
    createPlayerDto: CreatePlayerDto,
  ) {
    await this.assertCanManageTeamRoster(access, createPlayerDto.teamId);
    await this.assertTeamBelongsToOrganization(
      organizationId,
      createPlayerDto.teamId,
    );
    await this.rosterService.assertRosterEditable(createPlayerDto.teamId);
    await this.ensureJerseyAvailable(
      createPlayerDto.teamId,
      createPlayerDto.jerseyNumber,
    );

    return this.db
      .insertInto('admin.players')
      .values({
        jersey_number: createPlayerDto.jerseyNumber,
        name: createPlayerDto.name,
        position: createPlayerDto.position,
        status: createPlayerDto.status ?? 'active',
        team_id: createPlayerDto.teamId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findAll(
    organizationId: string,
    access: OrganizationAccessContext,
    query: PlayerListQueryDto,
  ) {
    const pagination = normalizePagination(query);
    let countQuery = this.db
      .selectFrom('admin.players as players')
      .innerJoin('admin.teams as teams', 'teams.id', 'players.team_id')
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
      .select((eb) => eb.fn.countAll().as('count'))
      .where('league_seasons.organization_id', '=', organizationId);
    let dataQuery = this.db
      .selectFrom('admin.players as players')
      .innerJoin('admin.teams as teams', 'teams.id', 'players.team_id')
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
        'players.created_at',
        'players.id',
        'players.jersey_number',
        'players.name',
        'players.position',
        'players.status',
        'players.team_id',
        'players.updated_at',
      ])
      .where('league_seasons.organization_id', '=', organizationId);

    if (
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.PLAYERS_READ_ASSIGNED_TEAM,
      ) &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
    ) {
      countQuery = countQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'players.team_id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
      dataQuery = dataQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'players.team_id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
    } else if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
    ) {
      throw new ForbiddenException('You cannot read organization players');
    }

    if (query.search) {
      const search = `%${query.search}%`;
      countQuery = countQuery.where((eb) =>
        eb.or([
          eb('players.name', 'ilike', search),
          eb('players.jersey_number', 'ilike', search),
          eb('players.position', 'ilike', search),
        ]),
      );
      dataQuery = dataQuery.where((eb) =>
        eb.or([
          eb('players.name', 'ilike', search),
          eb('players.jersey_number', 'ilike', search),
          eb('players.position', 'ilike', search),
        ]),
      );
    }

    if (query.teamId) {
      countQuery = countQuery.where('players.team_id', '=', query.teamId);
      dataQuery = dataQuery.where('players.team_id', '=', query.teamId);
    }

    if (query.divisionId) {
      countQuery = countQuery.where('teams.division_id', '=', query.divisionId);
      dataQuery = dataQuery.where('teams.division_id', '=', query.divisionId);
    }

    if (query.status) {
      countQuery = countQuery.where('players.status', '=', query.status);
      dataQuery = dataQuery.where('players.status', '=', query.status);
    }

    const sortDirection = query.sortDirection ?? 'asc';

    if (query.sortBy === 'name') {
      dataQuery = dataQuery
        .orderBy('players.name', sortDirection)
        .orderBy('players.id', 'asc');
    } else if (query.sortBy === 'team') {
      dataQuery = dataQuery
        .orderBy('teams.name', sortDirection)
        .orderBy('players.name', 'asc');
    } else if (query.sortBy === 'division') {
      dataQuery = dataQuery
        .orderBy('divisions.name', sortDirection)
        .orderBy('players.name', 'asc');
    } else if (query.sortBy === 'jerseyNumber') {
      dataQuery = dataQuery
        .orderBy('players.jersey_number', sortDirection)
        .orderBy('players.name', 'asc');
    } else if (query.sortBy === 'position') {
      dataQuery = dataQuery
        .orderBy('players.position', sortDirection)
        .orderBy('players.name', 'asc');
    } else if (query.sortBy === 'status') {
      dataQuery = dataQuery
        .orderBy('players.status', sortDirection)
        .orderBy('players.name', 'asc');
    } else if (query.sortBy === 'updated') {
      dataQuery = dataQuery
        .orderBy('players.updated_at', sortDirection)
        .orderBy('players.name', 'asc');
    } else {
      dataQuery = dataQuery
        .orderBy(
          'players.updated_at',
          query.sortDirection ?? 'desc',
        )
        .orderBy('players.name', 'asc');
    }

    const [total, data] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      dataQuery.limit(pagination.limit).offset(pagination.offset).execute(),
    ]);

    return createPaginatedResponse(data, Number(total.count), pagination);
  }

  async findOne(
    organizationId: string,
    playerId: string,
    access: OrganizationAccessContext,
  ) {
    let playerQuery = this.db
      .selectFrom('admin.players as players')
      .innerJoin('admin.teams as teams', 'teams.id', 'players.team_id')
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
        'players.created_at',
        'players.id',
        'players.jersey_number',
        'players.name',
        'players.position',
        'players.status',
        'players.team_id',
        'players.updated_at',
      ])
      .where('players.id', '=', playerId)
      .where('league_seasons.organization_id', '=', organizationId);

    if (
      access.permissions.includes(
        ORGANIZATION_PERMISSIONS.PLAYERS_READ_ASSIGNED_TEAM,
      ) &&
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
    ) {
      playerQuery = playerQuery
        .innerJoin(
          'access.team_manager_assignments as assigned_teams',
          'assigned_teams.team_id',
          'players.team_id',
        )
        .where(
          'assigned_teams.organization_member_id',
          '=',
          access.membershipId,
        );
    } else if (
      !access.permissions.includes(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)
    ) {
      throw new ForbiddenException('You cannot read organization players');
    }

    const player = await playerQuery.executeTakeFirst();

    if (!player) {
      throw new NotFoundException('Player not found');
    }

    return player;
  }

  async update(
    organizationId: string,
    playerId: string,
    access: OrganizationAccessContext,
    updatePlayerDto: UpdatePlayerDto,
  ) {
    const player = await this.findOne(organizationId, playerId, access);
    const targetTeamId = updatePlayerDto.teamId ?? player.team_id;
    await this.assertCanManageTeamRoster(access, targetTeamId);
    await this.rosterService.assertRosterEditable(player.team_id);
    if (targetTeamId !== player.team_id) {
      await this.rosterService.assertRosterEditable(targetTeamId);
    }

    if (updatePlayerDto.teamId && updatePlayerDto.teamId !== player.team_id) {
      await this.assertTeamBelongsToOrganization(
        organizationId,
        updatePlayerDto.teamId,
      );
    }

    if (
      (updatePlayerDto.jerseyNumber &&
        updatePlayerDto.jerseyNumber !== player.jersey_number) ||
      targetTeamId !== player.team_id
    ) {
      await this.ensureJerseyAvailable(
        targetTeamId,
        updatePlayerDto.jerseyNumber ?? player.jersey_number,
      );
    }

    return this.db
      .updateTable('admin.players')
      .set({
        jersey_number: updatePlayerDto.jerseyNumber,
        name: updatePlayerDto.name,
        position: updatePlayerDto.position,
        status: updatePlayerDto.status,
        team_id: updatePlayerDto.teamId,
        updated_at: new Date(),
      })
      .where('id', '=', playerId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async remove(
    organizationId: string,
    playerId: string,
    access: OrganizationAccessContext,
  ) {
    throw new ConflictException(
      'This record cannot be deleted. Archive support is being prepared so league history remains available.',
    );

    const player = await this.findOne(organizationId, playerId, access);
    await this.assertCanManageTeamRoster(access, player.team_id);
    await this.rosterService.assertRosterEditable(player.team_id);

    await this.db
      .deleteFrom('admin.players')
      .where('id', '=', playerId)
      .execute();

    return { success: true };
  }

  private async assertTeamBelongsToOrganization(
    organizationId: string,
    teamId: string,
  ): Promise<void> {
    const team = await this.db
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
      .select(['teams.id'])
      .where('teams.id', '=', teamId)
      .where('league_seasons.organization_id', '=', organizationId)
      .executeTakeFirst();

    if (!team) {
      throw new NotFoundException('Team not found in this organization');
    }
  }

  private async assertCanManageTeamRoster(
    access: OrganizationAccessContext,
    teamId: string,
  ): Promise<void> {
    if (access.permissions.includes(ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE)) {
      return;
    }

    if (
      !access.permissions.includes(
        ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE_ASSIGNED_TEAM,
      )
    ) {
      throw new ForbiddenException('You cannot manage players');
    }

    const assignment = await (this.db as any)
      .selectFrom('access.team_manager_assignments')
      .select(['id'])
      .where('organization_member_id', '=', access.membershipId)
      .where('team_id', '=', teamId)
      .executeTakeFirst();

    if (!assignment) {
      throw new NotFoundException('Team not found in your assignments');
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
