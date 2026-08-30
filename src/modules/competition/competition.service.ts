import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { buildCompetitionPlan } from './competition-plan.builder';
import { CompetitionRepository } from './competition.repository';
import type { GenerateCompetitionDto } from './dto/generate-competition.dto';
import type { SetPoolAssignmentsDto } from './dto/set-pool-assignments.dto';
import type { UpdateCompetitionFormatDto } from './dto/update-competition-format.dto';
import type {
  CrossoverMatchupDto,
  PlayoffFormat,
  QualifyingFormat,
  TiebreakerRule,
} from '../league-season/dto/league-season-competition-defaults.dto';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import { ScheduleService } from '../schedule/schedule.service';
import type { ScheduleMatchupDto } from './dto/schedule-matchup.dto';

@Injectable()
export class CompetitionService {
  constructor(
    private readonly repository: CompetitionRepository,
    @Optional() private readonly scheduleService?: ScheduleService,
  ) {}

  async getWorkspace(organizationId: string, divisionId: string) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    return this.repository.getWorkspace(format);
  }

  async getBracket(organizationId: string, divisionId: string) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    const matchups = await this.repository.listMatchups(
      format.id,
      format.revision,
    );

    return {
      formatRevision: format.revision,
      matchups: matchups.filter((matchup) => matchup.stage === 'playoff'),
      status: format.status,
    };
  }

  async updateFormat(
    organizationId: string,
    divisionId: string,
    dto: UpdateCompetitionFormatDto,
  ) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    this.assertDraft(format.status);

    return this.repository.updateFormat(format.id, dto);
  }

  async setPoolAssignments(
    organizationId: string,
    divisionId: string,
    dto: SetPoolAssignmentsDto,
  ) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    this.assertDraft(format.status);
    const [pools, divisionTeamIds] = await Promise.all([
      this.repository.listPoolsWithTeams(format.id),
      this.repository.listDivisionTeamIds(divisionId),
    ]);
    const knownPoolIds = new Set(pools.map((pool) => pool.id));
    const knownTeamIds = new Set(divisionTeamIds);
    const requestedTeamIds = dto.pools.flatMap((pool) => pool.teamIds);

    if (dto.pools.some((pool) => !knownPoolIds.has(pool.poolId))) {
      throw new BadRequestException('One of the selected pools was not found.');
    }
    if (requestedTeamIds.some((teamId) => !knownTeamIds.has(teamId))) {
      throw new BadRequestException(
        'Every selected team must belong to this division.',
      );
    }
    if (new Set(requestedTeamIds).size !== requestedTeamIds.length) {
      throw new BadRequestException(
        'A team can only be assigned to one pool.',
      );
    }

    await this.repository.setPoolAssignments(
      pools.map((pool) => pool.id),
      dto.pools,
    );
    return this.getWorkspace(organizationId, divisionId);
  }

  async generate(
    organizationId: string,
    divisionId: string,
    dto: GenerateCompetitionDto,
  ) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );

    if (format.status === 'locked') {
      return {
        formatRevision: format.revision,
        matchups: await this.repository.listMatchups(
          format.id,
          format.revision,
        ),
        status: 'locked',
      };
    }
    if (format.status === 'completed') {
      throw new ConflictException(
        'This competition is completed and cannot be generated again.',
      );
    }

    const [pools, divisionTeamIds] = await Promise.all([
      this.repository.listPoolsWithTeams(format.id),
      this.repository.listDivisionTeamIds(divisionId),
    ]);
    const assignedTeamIds = pools.flatMap((pool) => pool.teamIds);

    if (
      format.qualifying_format !== 'none' &&
      !this.hasSameMembers(assignedTeamIds, divisionTeamIds)
    ) {
      throw new BadRequestException(
        'Assign every division team to exactly one pool before generating matchups.',
      );
    }
    if (
      format.qualifying_format === 'none' &&
      !this.hasSameMembers(dto.directSeedTeamIds ?? [], divisionTeamIds)
    ) {
      throw new BadRequestException(
        'Confirm a seed order containing every division team before generating this bracket.',
      );
    }

    try {
      const plan = buildCompetitionPlan({
        crossoverTemplate:
          format.crossover_template as unknown as CrossoverMatchupDto[],
        directSeedTeamIds: dto.directSeedTeamIds,
        playoffFormat: format.playoff_format as PlayoffFormat,
        pools,
        qualifiersPerPool: format.qualifiers_per_pool,
        qualifyingFormat: format.qualifying_format as QualifyingFormat,
      });
      const matchups = await this.repository.lockAndInsertMatchups(
        format,
        plan,
      );

      return {
        formatRevision: format.revision,
        matchups,
        status: 'locked',
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'The competition format could not be generated.',
      );
    }
  }

  async reset(organizationId: string, divisionId: string) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    if (format.status === 'completed') {
      throw new ConflictException(
        'A completed competition cannot be reset.',
      );
    }

    return this.repository.reset(format.id);
  }

  async scheduleMatchup(
    organizationId: string,
    divisionId: string,
    matchupId: string,
    access: OrganizationAccessContext,
    dto: ScheduleMatchupDto,
  ) {
    const format = await this.repository.findFormatContext(
      organizationId,
      divisionId,
    );
    const matchup = await this.repository.findMatchup(format.id, matchupId);

    if (!matchup.home_team_id || !matchup.away_team_id) {
      throw new ConflictException(
        'This matchup is waiting for both teams and cannot be scheduled yet.',
      );
    }
    if (matchup.status !== 'ready') {
      throw new ConflictException(
        'This matchup has already been scheduled or completed.',
      );
    }
    if (!this.scheduleService) {
      throw new ConflictException('Scheduling is temporarily unavailable.');
    }

    const game = await this.scheduleService.create(organizationId, access, {
      awayTeamId: matchup.away_team_id,
      competitionKind: matchup.stage === 'playoff' ? 'playoff' : 'stage',
      divisionId,
      homeTeamId: matchup.home_team_id,
      leagueSeasonId: format.league_season_id,
      matchupId,
      scorekeeperMemberId: dto.scorekeeperMemberId,
      startsAt: dto.startsAt,
      status: 'scheduled',
      venueId: dto.venueId,
    });
    await this.repository.markMatchupScheduled(matchupId, game.id);
    return game;
  }

  private assertDraft(status: string): void {
    if (status !== 'draft') {
      throw new ConflictException(
        'The competition format is locked. Reset it before changing the rules.',
      );
    }
  }

  private hasSameMembers(left: string[], right: string[]): boolean {
    return (
      left.length === right.length &&
      new Set(left).size === left.length &&
      left.every((value) => right.includes(value))
    );
  }
}

export type CompetitionTiebreakers = TiebreakerRule[];
