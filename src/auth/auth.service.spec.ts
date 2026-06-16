import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthRepository } from './auth.repository';
import type { PasswordService } from './password.service';
import type { TokenService } from './token.service';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function createAuthServiceMocks() {
  const authRepository = {
    createSession: jest.fn(),
    createUserWithPassword: jest.fn(),
    findPasswordCredentialByUserId: jest.fn(),
    findRefreshTokenByHash: jest.fn(),
    findUserByEmail: jest.fn(),
    revokeRefreshToken: jest.fn(),
    revokeSession: jest.fn(),
  } as unknown as jest.Mocked<AuthRepository>;
  const passwordService = {
    hash: jest.fn(),
    verify: jest.fn(),
  } as unknown as jest.Mocked<PasswordService>;
  const tokenService = {
    getRefreshCookieMaxAgeMs: jest.fn(),
    hashRefreshToken: jest.fn(),
    issueSessionTokens: jest.fn(),
    signAccessToken: jest.fn(),
  } as unknown as jest.Mocked<TokenService>;

  tokenService.getRefreshCookieMaxAgeMs.mockReturnValue(2592000000);

  return {
    authRepository,
    passwordService,
    service: new AuthService(authRepository, passwordService, tokenService),
    tokenService,
  };
}

describe('AuthService', () => {
  it('registers a user with a hashed password and returns session tokens', async () => {
    const { authRepository, passwordService, service, tokenService } =
      createAuthServiceMocks();

    authRepository.findUserByEmail.mockResolvedValue(undefined);
    passwordService.hash.mockResolvedValue('hashed-password');
    authRepository.createUserWithPassword.mockResolvedValue(user);
    tokenService.issueSessionTokens.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    await expect(
      service.register({
        email: ' Admin@Example.com ',
        name: 'League Admin',
        password: 'password-123',
      }),
    ).resolves.toEqual({
      accessToken: 'access-token',
      refreshCookieMaxAgeMs: 2592000000,
      refreshToken: 'refresh-token',
      user,
    });
    expect(authRepository.findUserByEmail).toHaveBeenCalledWith(
      'admin@example.com',
    );
    expect(passwordService.hash).toHaveBeenCalledWith('password-123');
    expect(authRepository.createUserWithPassword).toHaveBeenCalledWith({
      email: 'admin@example.com',
      name: 'League Admin',
      passwordHash: 'hashed-password',
    });
  });

  it('rejects registration when the email already exists', async () => {
    const { authRepository, service } = createAuthServiceMocks();

    authRepository.findUserByEmail.mockResolvedValue(user);

    await expect(
      service.register({
        email: user.email,
        name: user.name,
        password: 'password-123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in a user with valid credentials and returns session tokens', async () => {
    const { authRepository, passwordService, service, tokenService } =
      createAuthServiceMocks();

    authRepository.findUserByEmail.mockResolvedValue(user);
    authRepository.findPasswordCredentialByUserId.mockResolvedValue({
      password_hash: 'hashed-password',
      user_id: user.id,
    });
    passwordService.verify.mockResolvedValue(true);
    tokenService.issueSessionTokens.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    await expect(
      service.login({
        email: 'admin@example.com',
        password: 'password-123',
      }),
    ).resolves.toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user,
    });
  });

  it('rejects login with invalid credentials', async () => {
    const { authRepository, service } = createAuthServiceMocks();

    authRepository.findUserByEmail.mockResolvedValue(undefined);

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'password-123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rotates refresh tokens and revokes the previous token', async () => {
    const { authRepository, service, tokenService } = createAuthServiceMocks();

    tokenService.hashRefreshToken.mockReturnValue('old-token-hash');
    authRepository.findRefreshTokenByHash.mockResolvedValue({
      expires_at: new Date(Date.now() + 60_000),
      id: 'refresh-token-1',
      revoked_at: null,
      session_id: 'session-1',
      user,
      user_id: user.id,
    });
    authRepository.revokeRefreshToken.mockResolvedValue(undefined);
    tokenService.issueSessionTokens.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });

    await expect(service.refresh('old-refresh-token')).resolves.toMatchObject({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      user,
    });
    expect(authRepository.revokeRefreshToken).toHaveBeenCalledWith(
      'refresh-token-1',
    );
    expect(tokenService.issueSessionTokens).toHaveBeenCalledWith(user, {
      rotatedFromTokenId: 'refresh-token-1',
      sessionId: 'session-1',
    });
  });

  it('revokes the session when a revoked refresh token is reused', async () => {
    const { authRepository, service, tokenService } = createAuthServiceMocks();

    tokenService.hashRefreshToken.mockReturnValue('old-token-hash');
    authRepository.findRefreshTokenByHash.mockResolvedValue({
      expires_at: new Date(Date.now() + 60_000),
      id: 'refresh-token-1',
      revoked_at: new Date(),
      session_id: 'session-1',
      user,
      user_id: user.id,
    });

    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(authRepository.revokeSession).toHaveBeenCalledWith('session-1');
  });
});
