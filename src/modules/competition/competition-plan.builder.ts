import type {
  CrossoverMatchupDto,
  PlayoffFormat,
  QualifyingFormat,
} from '../league-season/dto/league-season-competition-defaults.dto';
import { generateDoubleElimination } from './generators/double-elimination.generator';
import type {
  MatchupDependency,
  MatchupSource,
} from './generators/elimination.types';
import { generateRoundRobin } from './generators/round-robin.generator';
import { generateSingleElimination } from './generators/single-elimination.generator';

export type CompetitionPlanPool = {
  code: string;
  id: string;
  teamIds: string[];
};

export type CompetitionPlanMatchup = {
  awaySource: MatchupSource;
  awayTeamId: string | null;
  bracketSide: 'pool' | 'winners' | 'losers' | 'finals';
  homeSource: MatchupSource;
  homeTeamId: string | null;
  isResetFinal: boolean;
  key: string;
  label: string;
  loserTo: MatchupDependency | null;
  poolId: string | null;
  position: number;
  roundNumber: number;
  stage: 'qualifier' | 'playoff';
  winnerTo: MatchupDependency | null;
};

export type BuildCompetitionPlanInput = {
  crossoverTemplate: CrossoverMatchupDto[];
  directSeedTeamIds?: string[];
  playoffFormat: PlayoffFormat;
  pools: CompetitionPlanPool[];
  qualifiersPerPool: number;
  qualifyingFormat: QualifyingFormat;
};

function seededPositions(size: number): number[] {
  let positions = [1, 2];

  for (let currentSize = 4; currentSize <= size; currentSize *= 2) {
    positions = positions.flatMap((seed) => [seed, currentSize + 1 - seed]);
  }

  return positions;
}

function seedOrderForCrossover(
  crossoverTemplate: CrossoverMatchupDto[],
): string[] {
  const firstRoundSlots = crossoverTemplate.flatMap((matchup) => [
    matchup.homeSeed,
    matchup.awaySeed,
  ]);
  const size = firstRoundSlots.length;

  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(
      'The crossover template must fill a complete first playoff round.',
    );
  }

  const positions = seededPositions(size);
  const seedOrder = Array<string>(size);
  positions.forEach((seedNumber, index) => {
    seedOrder[seedNumber - 1] = firstRoundSlots[index];
  });

  return seedOrder;
}

function validateCrossoverSeeds(
  pools: CompetitionPlanPool[],
  qualifiersPerPool: number,
  crossoverTemplate: CrossoverMatchupDto[],
): void {
  const expectedSeedCount = pools.length * qualifiersPerPool;
  const allowed = new Set(
    pools.flatMap((pool) =>
      Array.from(
        { length: qualifiersPerPool },
        (_, index) => `${pool.code}${index + 1}`,
      ),
    ),
  );
  const selected = crossoverTemplate.flatMap((matchup) => [
    matchup.homeSeed,
    matchup.awaySeed,
  ]);

  if (selected.length !== expectedSeedCount) {
    throw new Error(
      'The crossover template must include every qualifying seed exactly once.',
    );
  }

  if (
    new Set(selected).size !== selected.length ||
    selected.some((seed) => !allowed.has(seed))
  ) {
    throw new Error(
      'Crossover seeds must be unique and refer to a qualifying pool.',
    );
  }
}

function validateQualifyingPools(
  pools: CompetitionPlanPool[],
  qualifiersPerPool: number,
): void {
  for (const pool of pools) {
    if (pool.teamIds.length < qualifiersPerPool || pool.teamIds.length < 2) {
      throw new Error(
        `Each pool must contain at least ${Math.max(2, qualifiersPerPool)} teams to qualify ${qualifiersPerPool} teams.`,
      );
    }
    if (new Set(pool.teamIds).size !== pool.teamIds.length) {
      throw new Error(`Pool ${pool.code} cannot contain the same team twice.`);
    }
  }
}

export function buildCompetitionPlan(
  input: BuildCompetitionPlanInput,
): CompetitionPlanMatchup[] {
  const qualifierMatchups: CompetitionPlanMatchup[] = [];

  if (input.qualifyingFormat !== 'none') {
    validateQualifyingPools(input.pools, input.qualifiersPerPool);
    for (const pool of input.pools) {
      const fixtures = generateRoundRobin(
        pool.teamIds,
        input.qualifyingFormat === 'double_round_robin',
      );

      qualifierMatchups.push(
        ...fixtures.map((fixture) => ({
          awaySource: { ref: fixture.awayTeamId, type: 'team' as const },
          awayTeamId: fixture.awayTeamId,
          bracketSide: 'pool' as const,
          homeSource: { ref: fixture.homeTeamId, type: 'team' as const },
          homeTeamId: fixture.homeTeamId,
          isResetFinal: false,
          key: `POOL-${pool.code}-R${fixture.roundNumber}-M${fixture.position}`,
          label: `Pool ${pool.code} - Round ${fixture.roundNumber}`,
          loserTo: null,
          poolId: pool.id,
          position: fixture.position,
          roundNumber: fixture.roundNumber,
          stage: 'qualifier' as const,
          winnerTo: null,
        })),
      );
    }
  }

  if (input.playoffFormat === 'none') return qualifierMatchups;

  let seededEntries: string[];
  let usesPoolSeeds = false;
  if (input.qualifyingFormat === 'none') {
    if (!input.directSeedTeamIds || input.directSeedTeamIds.length < 2) {
      throw new Error(
        'Confirm the team seed order before generating this bracket.',
      );
    }
    seededEntries = input.directSeedTeamIds;
  } else {
    validateCrossoverSeeds(
      input.pools,
      input.qualifiersPerPool,
      input.crossoverTemplate,
    );
    seededEntries = seedOrderForCrossover(input.crossoverTemplate);
    usesPoolSeeds = true;
  }

  const eliminationMatchups =
    input.playoffFormat === 'single_elimination'
      ? generateSingleElimination(seededEntries)
      : generateDoubleElimination(seededEntries);
  const playoffMatchups = eliminationMatchups.map((matchup) => {
    const mapSource = (source: MatchupSource): MatchupSource =>
      usesPoolSeeds && source.type === 'team'
        ? { ref: source.ref, type: 'pool_seed' }
        : source;

    return {
      ...matchup,
      awaySource: mapSource(matchup.awaySource),
      awayTeamId:
        !usesPoolSeeds && matchup.awaySource.type === 'team'
          ? matchup.awaySource.ref
          : null,
      homeSource: mapSource(matchup.homeSource),
      homeTeamId:
        !usesPoolSeeds && matchup.homeSource.type === 'team'
          ? matchup.homeSource.ref
          : null,
      poolId: null,
      stage: 'playoff' as const,
    };
  });

  return [...qualifierMatchups, ...playoffMatchups];
}
