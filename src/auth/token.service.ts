import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import { AuthRepository } from './auth.repository';
import type { AccessTokenPayload, AuthUser } from './auth.types';

type IssueSessionTokenOptions = {
  rotatedFromTokenId?: string;
  sessionId?: string;
};

type IssuedSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);

  if (!match) {
    throw new Error(`Unsupported duration format: ${duration}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
  };

  return amount * multipliers[unit as keyof typeof multipliers];
}

function randomToken(): string {
  return randomBytes(64).toString('base64url');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  getRefreshCookieMaxAgeMs(): number {
    return parseDurationToMs(this.config.auth.refreshTokenExpiresIn);
  }

  hashRefreshToken(refreshToken: string): string {
    return createHash('sha256')
      .update(refreshToken)
      .update(this.config.auth.refreshTokenSecret)
      .digest('hex');
  }

  async issueSessionTokens(
    user: AuthUser,
    options: IssueSessionTokenOptions = {},
  ): Promise<IssuedSessionTokens> {
    const refreshToken = randomToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + this.getRefreshCookieMaxAgeMs());
    const sessionId =
      options.sessionId ??
      (
        await this.authRepository.createSession(
          user.id,
          createHash('sha256').update(randomToken()).digest('hex'),
          expiresAt,
        )
      ).id;

    await this.authRepository.createRefreshToken({
      expiresAt,
      rotatedFromTokenId: options.rotatedFromTokenId,
      sessionId,
      tokenHash: refreshTokenHash,
      userId: user.id,
    });

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
    };
  }

  async signAccessToken(user: AuthUser): Promise<string> {
    return this.jwtService.signAsync(
      {
        email: user.email,
        sub: user.id,
      } satisfies AccessTokenPayload,
      {
        expiresIn: this.config.auth.accessTokenExpiresIn,
        secret: this.config.auth.accessTokenSecret,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    try {
      return await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.auth.accessTokenSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
