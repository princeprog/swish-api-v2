import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GenerateCompetitionDto } from './generate-competition.dto';
import { SetPoolAssignmentsDto } from './set-pool-assignments.dto';
import { RecordTieDecisionDto } from './record-tie-decision.dto';

const poolA = 'c0a80121-0000-4000-8000-000000000001';
const poolB = 'c0a80121-0000-4000-8000-000000000002';
const teamA = 'c0a80121-0000-4000-8000-000000000011';
const teamB = 'c0a80121-0000-4000-8000-000000000012';

describe('competition DTOs', () => {
  it('accepts unique team assignments across pools', async () => {
    const dto = plainToInstance(SetPoolAssignmentsDto, {
      pools: [
        { poolId: poolA, teamIds: [teamA] },
        { poolId: poolB, teamIds: [teamB] },
      ],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a team assigned to more than one pool', async () => {
    const dto = plainToInstance(SetPoolAssignmentsDto, {
      pools: [
        { poolId: poolA, teamIds: [teamA] },
        { poolId: poolB, teamIds: [teamA] },
      ],
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('validates an optional unique direct seed order', async () => {
    const valid = plainToInstance(GenerateCompetitionDto, {
      directSeedTeamIds: [teamA, teamB],
    });
    const duplicate = plainToInstance(GenerateCompetitionDto, {
      directSeedTeamIds: [teamA, teamA],
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(await validate(duplicate)).not.toHaveLength(0);
  });

  it('requires a unique ordered list and a meaningful tie-decision reason', async () => {
    const valid = plainToInstance(RecordTieDecisionDto, {
      orderedTeamIds: [teamB, teamA],
      poolId: poolA,
      reason: 'The league committee confirmed the published order.',
      teamIds: [teamA, teamB],
    });
    const invalid = plainToInstance(RecordTieDecisionDto, {
      orderedTeamIds: [teamA, teamA],
      poolId: poolA,
      reason: 'short',
      teamIds: [teamA, teamB],
    });

    await expect(validate(valid)).resolves.toHaveLength(0);
    expect(await validate(invalid)).not.toHaveLength(0);
  });
});
