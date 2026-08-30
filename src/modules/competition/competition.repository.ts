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
      .executeTakeFirst();

    if (!format) throw new NotFoundException('Competition format not found');
    return format;
  }

  async getWorkspace(format: CompetitionFormatContext) {
    const [pools, matchups, standings, tieDecisions] = await Promise.all([
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
    ]);

    return { format, matchups, pools, standings, tieDecisions };
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
      .orderBy('created_at asc')
      .execute()
      .then((rows) => rows.map((row) => row.id));
  }

  async setPoolAssignments(
    allPoolIds: string[],
    assignments: PoolTeamAssignmentDto[],
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
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

  async markMatchupScheduled(matchupId: string, gameId: string): Promise<void> {
    await this.db
      .updateTable('competition.matchups')
      .set({ status: 'scheduled', updated_at: new Date() })
      .where('id', '=', matchupId)
      .where('status', '=', 'ready')
      .executeTakeFirstOrThrow();
    void gameId;
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
      const linkedGame = await trx
        .selectFrom('competition.games as games')
        .innerJoin(
          'competition.matchups as matchups',
          'matchups.id',
          'games.matchup_id',
        )
        .select('games.id')
        .where('matchups.division_format_id', '=', formatId)
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
        .deleteFrom('competition.matchups')
        .where('division_format_id', '=', formatId)
        .execute();
      const currentFormat = await trx
        .selectFrom('competition.division_formats')
        .select('revision')
        .where('id', '=', formatId)
        .forUpdate()
        .executeTakeFirstOrThrow();
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
