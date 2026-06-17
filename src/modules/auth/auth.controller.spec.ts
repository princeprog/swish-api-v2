import type { Response } from 'express';
import { AuthController } from './auth.controller';
import type { CookieRequest } from './auth.request';
import type { AuthService } from './auth.service';

const user = {
  email: 'admin@example.com',
  id: 'user-1',
  name: 'League Admin',
};

function createResponseMock(): Response {
  return {
    clearCookie: jest.fn(),
    cookie: jest.fn(),
  } as unknown as Response;
}

function createAuthController() {
  const authService = {
    getMe: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    register: jest.fn(),
  } as unknown as jest.Mocked<AuthService>;

  return {
    authService,
    controller: new AuthController(authService),
  };
}

function createCookieRequest(token: string): CookieRequest {
  return {
    cookies: {
      swish_refresh_token: token,
    },
  } as unknown as CookieRequest;
}

describe('AuthController', () => {
  it('sets the refresh token cookie after registration', async () => {
    const { authService, controller } = createAuthController();
    const response = createResponseMock();

    authService.register.mockResolvedValue({
      accessToken: 'access-token',
      refreshCookieMaxAgeMs: 1000,
      refreshToken: 'refresh-token',
      user,
    });

    await expect(
      controller.register(
        {
          email: user.email,
          name: user.name,
          password: 'password-123',
        },
        response,
      ),
    ).resolves.toEqual({ user });
    expect(response.cookie).toHaveBeenCalledWith(
      'swish_access_token',
      'access-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'swish_refresh_token',
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 1000,
        sameSite: 'lax',
      }),
    );
  });

  it('clears the refresh token cookie after logout', async () => {
    const { authService, controller } = createAuthController();
    const response = createResponseMock();

    authService.logout.mockResolvedValue(undefined);

    await expect(
      controller.logout(createCookieRequest('refresh-token'), response),
    ).resolves.toEqual({ success: true });
    expect(authService.logout).toHaveBeenCalledWith('refresh-token');
    expect(response.clearCookie).toHaveBeenCalledWith(
      'swish_refresh_token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
  });

  it('refreshes tokens from the refresh cookie', async () => {
    const { authService, controller } = createAuthController();
    const response = createResponseMock();

    authService.refresh.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshCookieMaxAgeMs: 1000,
      refreshToken: 'new-refresh-token',
      user,
    });

    await expect(
      controller.refresh(createCookieRequest('old-refresh-token'), response),
    ).resolves.toEqual({ user });
    expect(response.cookie).toHaveBeenCalledWith(
      'swish_access_token',
      'new-access-token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(authService.refresh).toHaveBeenCalledWith('old-refresh-token');
    expect(response.cookie).toHaveBeenCalledWith(
      'swish_refresh_token',
      'new-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        maxAge: 1000,
        sameSite: 'lax',
      }),
    );
  });

  it('clears both auth cookies after logout', async () => {
    const { authService, controller } = createAuthController();
    const response = createResponseMock();

    authService.logout.mockResolvedValue(undefined);

    await controller.logout(createCookieRequest('refresh-token'), response);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'swish_access_token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'swish_refresh_token',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
  });
});
