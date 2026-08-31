import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ClaimScoringControlDto,
  ScoringCommandDto,
  ScoringControlTokenDto,
  TakeoverScoringControlDto,
} from './scoring-command.dto';

async function firstConstraint(value: object) {
  const [error] = await validate(value);
  return Object.values(error.constraints ?? {})[0];
}

describe('scoring DTO user-facing validation', () => {
  it('rejects blank command fields with safe copy', async () => {
    const dto = plainToInstance(ScoringCommandDto, {
      controlToken: ' ',
      expectedVersion: 0,
      idempotencyKey: ' ',
      occurredAt: new Date().toISOString(),
      type: ' ',
    });

    await expect(firstConstraint(dto)).resolves.toBe(
      'Enter a valid scoring request reference.',
    );
    await expect(firstConstraint(plainToInstance(ScoringControlTokenDto, { controlToken: ' ' }))).resolves.toBe(
      'Your scoring control is no longer valid. Claim control again.',
    );
  });

  it('rejects whitespace-only device labels with safe copy', async () => {
    await expect(
      firstConstraint(plainToInstance(ClaimScoringControlDto, { deviceLabel: ' ' })),
    ).resolves.toBe('Enter a device name.');
    await expect(
      firstConstraint(
        plainToInstance(TakeoverScoringControlDto, {
          deviceLabel: ' ',
          reason: 'Take control',
        }),
      ),
    ).resolves.toBe('Enter a device name.');
  });

  it('uses calm messages for command envelope validation', async () => {
    await expect(
      firstConstraint(
        plainToInstance(ScoringCommandDto, {
          expectedVersion: 'newer',
          idempotencyKey: 'command-1',
          occurredAt: new Date().toISOString(),
          type: 'game.start',
        }),
      ),
    ).resolves.toBe('The game changed. Refresh it and try again.');
    await expect(
      firstConstraint(
        plainToInstance(ScoringCommandDto, {
          expectedVersion: -1,
          idempotencyKey: 'command-1',
          occurredAt: new Date().toISOString(),
          type: 'game.start',
        }),
      ),
    ).resolves.toBe('The game changed. Refresh it and try again.');
    await expect(
      firstConstraint(
        plainToInstance(ScoringCommandDto, {
          expectedVersion: 0,
          idempotencyKey: 'command-1',
          occurredAt: 'not-a-date',
          type: 'game.start',
        }),
      ),
    ).resolves.toBe('Choose a valid game time and try again.');
    await expect(
      firstConstraint(
        plainToInstance(ScoringCommandDto, {
          expectedVersion: 0,
          idempotencyKey: 'command-1',
          occurredAt: new Date().toISOString(),
          payload: 'not-an-object',
          type: 'game.start',
        }),
      ),
    ).resolves.toBe('This scoring action is missing required information.');
  });
});
