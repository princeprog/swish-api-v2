import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { AuthSessionResult, AuthUser } from './auth.types';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sanitizeName(name: string): string {
  return name.trim();
}

@Injectable()
export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  getMe(user: AuthUser) {
    return { user };
  }

  async login(input: LoginDto): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const user = await this.authRepository.findUserByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const credential = await this.authRepository.findPasswordCredentialByUserId(
      user.id,
    );

    if (!credential) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isValidPassword = await this.passwordService.verify(
      credential.password_hash,
      input.password,
    );

    if (!isValidPassword) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.createSessionResult(user);
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const tokenRecord =
      await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (tokenRecord) {
      await this.authRepository.revokeRefreshToken(tokenRecord.id);
    }
  }

  async refresh(refreshToken?: string): Promise<AuthSessionResult> {
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const tokenRecord =
      await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.revoked_at) {
      await this.authRepository.revokeSession(tokenRecord.session_id);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (tokenRecord.expires_at.getTime() <= Date.now()) {
      await this.authRepository.revokeRefreshToken(tokenRecord.id);
      throw new UnauthorizedException('Refresh token expired');
    }

    await this.authRepository.revokeRefreshToken(tokenRecord.id);

    return this.createSessionResult(tokenRecord.user, {
      rotatedFromTokenId: tokenRecord.id,
      sessionId: tokenRecord.session_id,
    });
  }

  async register(input: RegisterDto): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const existingUser = await this.authRepository.findUserByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await this.passwordService.hash(input.password);
    const user = await this.authRepository.createUserWithPassword({
      email,
      name: sanitizeName(input.name),
      passwordHash,
    });

    return this.createSessionResult(user);
  }

  private async createSessionResult(
    user: AuthUser,
    options: Parameters<TokenService['issueSessionTokens']>[1] = {},
  ): Promise<AuthSessionResult> {
    const tokens = await this.tokenService.issueSessionTokens(user, options);

    return {
      accessToken: tokens.accessToken,
      refreshCookieMaxAgeMs: this.tokenService.getRefreshCookieMaxAgeMs(),
      refreshToken: tokens.refreshToken,
      user,
    };
  }
}
