import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

function createGuard() {
  const authRepository = {
    findUserById: jest.fn(),
  };
  const tokenService = {
    verifyAccessToken: jest.fn(),
  };

  return {
    authRepository,
    guard: new JwtAuthGuard(authRepository as never, tokenService as never),
    tokenService,
  };
}

describe('JwtAuthGuard', () => {
  it('authorizes requests using the access token cookie', async () => {
    const { authRepository, guard, tokenService } = createGuard();
    const request = {
      cookies: {
        swish_access_token: 'cookie-token',
      },
      headers: {},
    };

    tokenService.verifyAccessToken.mockResolvedValue({ sub: user.id });
    authRepository.findUserById.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('cookie-token');
    expect(request.user).toEqual(user);
  });

  it('falls back to the bearer token when no access cookie is present', async () => {
    const { authRepository, guard, tokenService } = createGuard();
    const request = {
      cookies: {},
      headers: {
        authorization: 'Bearer header-token',
      },
    };

    tokenService.verifyAccessToken.mockResolvedValue({ sub: user.id });
    authRepository.findUserById.mockResolvedValue(user);

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(tokenService.verifyAccessToken).toHaveBeenCalledWith('header-token');
  });

  it('rejects requests that have no access token', async () => {
    const { guard } = createGuard();
    const request = {
      cookies: {},
      headers: {},
    };

    await expect(guard.canActivate(createContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
