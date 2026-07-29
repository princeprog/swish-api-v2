import { InvitationTokenService } from './invitation-token.service';

describe('InvitationTokenService', () => {
  it('generates random tokens and hashes only the persisted value', () => {
    const service = new InvitationTokenService();

    const first = service.createTokenPair();
    const second = service.createTokenPair();

    expect(first.token).not.toEqual(second.token);
    expect(first.tokenHash).not.toEqual(first.token);
    expect(first.tokenHash).not.toEqual(second.tokenHash);
    expect(service.hashToken(first.token)).toEqual(first.tokenHash);
  });

  it('normalizes invitation emails for duplicate and acceptance checks', () => {
    const service = new InvitationTokenService();

    expect(service.normalizeEmail(' Staff.User@Example.COM ')).toBe(
      'staff.user@example.com',
    );
  });
});
