import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  RecordStatisticEventDto,
  StatisticsOverrideDto,
} from './statistics-command.dto';

describe('statistics DTOs', () => {
  it('accepts a versioned, idempotent player statistic', async () => {
    const dto = plainToInstance(RecordStatisticEventDto, {
      controlToken: 'control-token',
      expectedVersion: 0,
      idempotencyKey: 'command-1',
      occurredAt: '2026-09-01T10:00:00.000Z',
      playerId: 'c0a80121-0000-4000-8000-000000000001',
      type: 'points',
      value: 3,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('requires a meaningful audited override reason', async () => {
    const dto = plainToInstance(StatisticsOverrideDto, { reason: 'short' });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
