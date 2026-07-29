import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class InvitationTokenService {
  createTokenPair(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');

    return {
      token,
      tokenHash: this.hashToken(token),
    };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
