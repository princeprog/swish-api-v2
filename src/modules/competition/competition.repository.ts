import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { serializeJsonArray } from '../../common/database/json-value';
import type { Json } from '../../database/db';
import { DATABASE, type Database } from '../../database/database.tokens';
import type { CompetitionPlanMatchup } from './competition-plan.builder';
import type { PoolTeamAssignmentDto } from './dto/set-pool-assignments.dto';
import type { UpdateCompetitionFormatDto } from './dto/update-competition-format.dto';
import type { OrganizationAccessContext } from '../../common/auth/roles';
import { resolveGeneratedByes } from './bye-progression';

export type CompetitionFormatContext = {
  crossover_template: Json;
  division_id: string;
  division_name: string;
  id: string;
  league_season_id: string;
  playoff_format: string;
  pool_count: number;
  qualifiers_per_pool: number;
  qualifying_format: string;
  revision: number;
  schedule_slot_duration_minutes: number;
  status: string;
  tiebreakers: Json;
};

@Injectable()
export class CompetitionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findFormatContext(
    organizationId: string,
    divisionId: string,
  ): Promise<CompetitionFormatContext> {
    const format = await this.db
      .selectFrom('competition.division_formats as formats')
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
        'formats.crossover_template',
        'formats.division_id',
        'divisions.name as division_name',
        'formats.id',
        'divisions.league_season_id',
        'formats.playoff_format',
        'formats.pool_count',
        'formats.qualifiers_per_pool',
        'formats.qualifying_format',
        'formats.revision',
        'seasons.schedule_slot_duration_minutes',
        'formats.status',
        'formats.tiebreakers',
      ])
      .where('formats.division_id', '=', divisionId)
      .where('seasons.organization_id', '=', organizationId)
      .where('divisions.archived_at', 'is', null)
      .where('seasons.archived_at', 'is', null)
      .executeTakeFirst();

    if (!format) throw new NotFoundException('Competition format not found');
    return format;
  }

  async getWorkspace(format: CompetitionFormatContext) {
    const [pools, matchups, standings, tieDecisions, latestStanding] =
      await Promise.all([
        this.listPoolsWithTeams(format.id),
        this.listMatchups(format.id, format.revision),
        this.db
          .selectFrom('competition.standings_projections')
          .selectAll()
          .where('division_format_id', '=', format.id)
          .orderBy('pool_id asc')
          .orderBy('rank asc')
          .execute(),
        this.db
          .selectFrom('competition.tie_decisions')
          .selectAll()
          .where('division_format_id', '=', format.id)
          .orderBy('created_at desc')
          .execute(),
        this.db
          .selectFrom('competition.standings_projections')
          .select('version')
          .where('division_format_id', '=', format.id)
          .orderBy('version desc')
          .executeTakeFirst(),
      ]);

    return {
      format,
      matchups,
      pools,
      standings,
      standingsRevision: latestStanding?.version ?? 0,
      tieDecisions,
    };
  }

  async updateFormat(formatId: string, dto: UpdateCompetitionFormatDto) {
    return this.db.transaction().execute(async (trx) => {
      const updated = await trx
        .updateTable('competition.division_formats')
        .set({
          crossover_template:
            dto.crossoverTemplate === undefined
              ? undefined
              : serializeJsonArray(
                  dto.crossoverTemplate.map((matchup) => ({
                    awaySeed: matchup.awaySeed,
                    homeSeed: matchup.homeSeed,
                  })),
                ),
          playoff_format: dto.playoffFormat,
          pool_count: dto.poolCount,
          qualifiers_per_pool: dto.qualifiersPerPool,
          qualifying_format: dto.qualifyingFormat,
          tiebreakers:
            dto.tiebreakers === undefined
              ? undefined
              : serializeJsonArray(dto.tiebreakers),
          updated_at: new Date(),
        })
        .where('id', '=', formatId)
        .where('status', '=', 'draft')
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new ConflictException(
          'The competition format changed before your update was saved. Refresh and try again.',
        );
      }

      if (dto.poolCount !== undefined) {
        const existingPools = await trx
          .selectFrom('competition.pools')
          .selectAll()
          .where('division_format_id', '=', formatId)
          .orderBy('sort_order asc')
          .execute();

        if (existingPools.length > dto.poolCount) {
          await trx
            .deleteFrom('competition.pools')
            .where(
              'id',
              'in',
              existingPools.slice(dto.poolCount).map((pool) => pool.id),
            )
            .execute();
        } else if (existingPools.length < dto.poolCount) {
          await trx
            .insertInto('competition.pools')
            .values(
              Array.from(
                { length: dto.poolCount - existingPools.length },
                (_, offset) => {
                  const index = existingPools.length + offset;
                  const code = String.fromCharCode(65 + index);
                  return {
                    code,
                    division_format_id: formatId,
                    name: `Pool ${code}`,
                    sort_order: index + 1,
                  };
                },
              ),
            )
            .execute();
        }
      }

      return updated;
    });
  }

  async listPoolsWithTeams(formatId: string) {
    const rows = await this.db
      .selectFrom('competition.pools as pools')
      .leftJoin(
        'competition.pool_teams as pool_teams',
        'pool_teams.pool_id',
        'pools.id',
      )
      .leftJoin('admin.teams as teams', 'teams.id', 'pool_teams.team_id')
      .select([
        'pools.code',
        'pools.id',
        'pools.name',
        'pools.sort_order',
        'pool_teams.seed',
        'teams.id as team_id',
        'teams.name as team_name',
      ])
      .where('pools.division_format_id', '=', formatId)
      .where('teams.archived_at', 'is', null)
      .orderBy('pools.sort_order asc')
      .orderBy('pool_teams.seed asc')
      .execute();
    const pools = new Map<
      string,
      {
        code: string;
        id: string;
        name: string;
        sortOrder: number;
        teamIds: string[];
        teams: Array<{ id: string; name: string; seed: number | null }>;
      }
    >();

    for (const row of rows) {
      const pool = pools.get(row.id) ?? {
        code: row.code,
        id: row.id,
        name: row.name,
        sortOrder: row.sort_order,
        teamIds: [],
        teams: [],
      };
      if (row.team_id && row.team_name) {
        pool.teamIds.push(row.team_id);
        pool.teams.push({
          id: row.team_id,
          name: row.team_name,
          seed: row.seed,
        });
      }
      pools.set(row.id, pool);
    }

    return [...pools.values()];
  }

  listDivisionTeamIds(divisionId: string) {
    return this.db
      .selectFrom('admin.teams')
      .select('id')
      .where('division_id', '=', divisionId)
      .where('status', '=', 'active')
      .where('archived_at', 'is', null)
      .orderBy('created_at asc')
      .execute()
      .then((rows) => rows.map((row) => row.id));
  }

  async setPoolAssignments(
    allPoolIds: string[],
    assignments: PoolTeamAssignmentDto[],
    formatId?: string,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      if (formatId) {
        const format = await trx
          .selectFrom('competition.division_formats')
          .select(['id', 'status'])
          .where('id', '=', formatId)
          .forUpdate()
          .executeTakeFirst();
        if (!format) {
          throw new NotFoundException('Competition format not found');
        }
        if (format.status !== 'draft') {
          throw new ConflictException(
            'The competition format is locked. Reset it before changing pool assignments.',
          );
        }
      }
      await trx
        .deleteFrom('competition.pool_teams')
        .where('pool_id', 'in', allPoolIds)
        .execute();
      const rows = assignments.flatMap((pool) =>
        pool.teamIds.map((teamId, index) => ({
          pool_id: pool.poolId,
          seed: index + 1,
          team_id: teamId,
        })),
      );
      if (rows.length > 0) {
        await trx.insertInto('competition.pool_teams').values(rows).execute();
      }
    });
  }

  listMatchups(formatId: string, revision: number) {
    return this.db
      .selectFrom('competition.matchups')
      .selectAll()
      .where('division_format_id', '=', formatId)
      .where('format_revision', '=', revision)
      .orderBy('stage asc')
      .orderBy('bracket_side asc')
      .orderBy('round_number asc')
      .orderBy('position asc')
      .execute();
  }

  async findMatchup(formatId: string, matchupId: string) {
    const matchup = await this.db
      .selectFrom('competition.matchups')
      .selectAll()
      .where('id', '=', matchupId)
      .where('division_format_id', '=', formatId)
      .executeTakeFirst();
    if (!matchup) throw new NotFoundException('Matchup not found');
    return matchup;
  }

  /**
   * Acquire the format lock before a generated matchup is scheduled. Every
   * caller must use this method as the first lock in the scheduling workflow
   * so concurrent format edits and matchup materialization serialize the same
   * way.
   */
  async lockSeasonForScheduling(
    trx: any,
    organizationId: string,
    divisionId: string,
  ) {
    const season = await trx
      .selectFrom('admin.league_seasons as seasons')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.league_season_id',
        'seasons.id',
      )
      .select(['seasons.id', 'seasons.schedule_slot_duration_minutes'])
      .where('seasons.organization_id', '=', organizationId)
      .where('divisions.id', '=', divisionId)
      .where('seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!season) throw new NotFoundException('Competition format not found');
    return season;
  }

  async lockFormatForScheduling(
    trx: any,
    organizationId: string,
    divisionId: string,
  ): Promise<CompetitionFormatContext> {
    const format = await trx
      .selectFrom('competition.division_formats as formats')
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
        'formats.crossover_template',
        'formats.division_id',
        'divisions.name as division_name',
        'formats.id',
        'divisions.league_season_id',
        'formats.playoff_format',
        'formats.pool_count',
        'formats.qualifiers_per_pool',
        'formats.qualifying_format',
        'formats.revision',
        'seasons.schedule_slot_duration_minutes',
        'formats.status',
        'formats.tiebreakers',
      ])
      .where('formats.division_id', '=', divisionId)
      .where('seasons.organization_id', '=', organizationId)
      .where('seasons.archived_at', 'is', null)
      .where('divisions.archived_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();

    if (!format) throw new NotFoundException('Competition format not found');
    return format;
  }

  /** Lock the target matchup only after its parent format has been locked. */
  async lockMatchupForScheduling(
    trx: any,
    formatId: string,
    matchupId: string,
  ) {
    const matchup = await trx
      .selectFrom('competition.matchups')
      .selectAll()
      .where('id', '=', matchupId)
      .where('division_format_id', '=', formatId)
      .forUpdate()
      .executeTakeFirst();
    if (!matchup) throw new NotFoundException('Matchup not found');
    return matchup;
  }

  async markMatchupScheduled(matchupId: string, gameId: string): Promise<void> {
    await this.markMatchupScheduledInTransaction(matchupId, gameId, this.db);
  }

  async markMatchupScheduledInTransaction(
    matchupId: string,
    gameId: string,
    trx: any,
  ): Promise<void> {
    const game = await trx
      .selectFrom('competition.games')
      .select(['id', 'matchup_id'])
      .where('id', '=', gameId)
      .where('matchup_id', '=', matchupId)
      .where('archived_at', 'is', null)
      .executeTakeFirst();

    if (!game) {
      throw new ConflictException(
        'The scheduled game does not belong to this generated matchup.',
      );
    }

    const updated = await trx
      .updateTable('competition.matchups')
      .set({ status: 'scheduled', updated_at: new Date() })
      .where('id', '=', matchupId)
      .where('status', '=', 'ready')
      .executeTakeFirst();

    if (!updated || Number(updated.numUpdatedRows ?? 0) !== 1) {
      throw new ConflictException(
        'This generated matchup has already been scheduled. Refresh and try again.',
      );
    }
  }

  async lockAndInsertMatchups(
    format: CompetitionFormatContext,
    plan: CompetitionPlanMatchup[],
  ) {
    return this.db.transaction().execute(async (trx) => {
      const now = new Date();
      const locked = await trx
        .updateTable('competition.division_formats')
        .set({
          generated_at: now,
          locked_at: now,
          status: 'locked',
          updated_at: now,
        })
        .where('id', '=', format.id)
        .where('status', '=', 'draft')
        .returning('id')
        .executeTakeFirst();

      if (!locked) {
        throw new ConflictException(
          'The format was already generated. Refresh to view its matchups.',
        );
      }

      const idsByKey = new Map(
        plan.map((matchup) => [matchup.key, randomUUID()]),
      );
      const resolvedByKey = new Map(
        resolveGeneratedByes(plan).map((matchup) => [matchup.key, matchup]),
      );
      const sourceRef = (type: string, ref: string | null): string | null =>
        ref && (type === 'matchup_winner' || type === 'matchup_loser')
          ? (idsByKey.get(ref) ?? ref)
          : ref;

      if (plan.length > 0) {
        await trx
          .insertInto('competition.matchups')
          .values(
            plan.map((matchup) => ({
              ...(() => {
                const resolved = resolvedByKey.get(matchup.key)!;
                return {
                  away_team_id: resolved.awayTeamId,
                  home_team_id: resolved.homeTeamId,
                  loser_team_id: resolved.loserTeamId,
                  status: resolved.status,
                  winner_team_id: resolved.winnerTeamId,
                };
              })(),
              away_source_ref: sourceRef(
                matchup.awaySource.type,
                matchup.awaySource.ref,
              ),
              away_source_type: matchup.awaySource.type,
              bracket_side: matchup.bracketSide,
              division_format_id: format.id,
              format_revision: format.revision,
              home_source_ref: sourceRef(
                matchup.homeSource.type,
                matchup.homeSource.ref,
              ),
              home_source_type: matchup.homeSource.type,
              id: idsByKey.get(matchup.key),
              is_reset_final: matchup.isResetFinal,
              label: matchup.label,
              pool_id: matchup.poolId,
              position: matchup.position,
              round_number: matchup.roundNumber,
              stage: matchup.stage,
            })),
          )
          .execute();

        for (const matchup of plan) {
          await trx
            .updateTable('competition.matchups')
            .set({
              loser_to_matchup_id: matchup.loserTo
                ? idsByKey.get(matchup.loserTo.matchupKey)
                : null,
              loser_to_slot: matchup.loserTo?.slot ?? null,
              winner_to_matchup_id: matchup.winnerTo
                ? idsByKey.get(matchup.winnerTo.matchupKey)
                : null,
              winner_to_slot: matchup.winnerTo?.slot ?? null,
            })
            .where('id', '=', idsByKey.get(matchup.key) as string)
            .execute();
        }
      }

      return trx
        .selectFrom('competition.matchups')
        .selectAll()
        .where('division_format_id', '=', format.id)
        .where('format_revision', '=', format.revision)
        .orderBy('stage asc')
        .orderBy('round_number asc')
        .orderBy('position asc')
        .execute();
    });
  }

  async reset(formatId: string) {
    return this.db.transaction().execute(async (trx) => {
      const currentFormat = await trx
        .selectFrom('competition.division_formats')
        .select(['id', 'revision', 'status'])
        .where('id', '=', formatId)
        .forUpdate()
        .executeTakeFirst();
      if (!currentFormat) {
        throw new NotFoundException('Competition format not found');
      }
      if (currentFormat.status === 'completed') {
        throw new ConflictException('A completed competition cannot be reset.');
      }
      const linkedGame = await trx
        .selectFrom('competition.games as games')
        .innerJoin(
          'competition.matchups as matchups',
          'matchups.id',
          'games.matchup_id',
        )
        .select('games.id')
        .where('matchups.division_format_id', '=', formatId)
        .where('games.archived_at', 'is', null)
        .executeTakeFirst();

      if (linkedGame) {
        throw new ConflictException(
          'Remove scheduled games from these matchups before resetting the format.',
        );
      }

      await trx
        .deleteFrom('competition.standings_projections')
        .where('division_format_id', '=', formatId)
        .execute();
      await trx
        .deleteFrom('competition.tie_decisions')
        .where('division_format_id', '=', formatId)
        .execute();
      await trx
        .updateTable('competition.matchups')
        .set({ status: 'void', updated_at: new Date() })
        .where('division_format_id', '=', formatId)
        .where('format_revision', '=', currentFormat.revision)
        .execute();
      await trx
        .updateTable('competition.division_formats')
        .set({
          generated_at: null,
          locked_at: null,
          revision: currentFormat.revision + 1,
          status: 'draft',
          updated_at: new Date(),
        })
        .where('id', '=', formatId)
        .executeTakeFirstOrThrow();

      return { success: true };
    });
  }

  async recordTieDecision(
    formatId: string,
    poolId: string,
    tieKey: string,
    teamIds: string[],
    orderedTeamIds: string[],
    reason: string,
    access: OrganizationAccessContext,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const decision = await trx
        .insertInto('competition.tie_decisions')
        .values({
          decided_by_member_id: access.membershipId,
          division_format_id: formatId,
          ordered_team_ids: serializeJsonArray(orderedTeamIds),
          pool_id: poolId,
          reason,
          team_ids: serializeJsonArray(teamIds),
          tie_key: tieKey,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['division_format_id', 'pool_id', 'tie_key'])
            .doUpdateSet({
              decided_by_member_id: access.membershipId,
              ordered_team_ids: serializeJsonArray(orderedTeamIds),
              reason,
              team_ids: serializeJsonArray(teamIds),
            }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access.audit_events')
        .values({
          action: 'standings.tie_decided',
          actor_member_id: access.membershipId,
          metadata: { orderedTeamIds, poolId, reason, teamIds, tieKey },
          organization_id: access.organizationId,
          target_id: formatId,
          target_type: 'division_format',
        })
        .execute();
      return decision;
    });
  }
}
