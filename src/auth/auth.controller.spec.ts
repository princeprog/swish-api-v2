import type { Response } from 'express';
import { AuthController } from './auth.controller';
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
    ).resolves.toEqual({
      accessToken: 'access-token',
      user,
    });
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
      controller.logout(
        {
          cookies: {
            swish_refresh_token: 'refresh-token',
          },
        },
        response,
      ),
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
      controller.refresh(
        {
          cookies: {
            swish_refresh_token: 'old-refresh-token',
          },
        },
        response,
      ),
    ).resolves.toEqual({
      accessToken: 'new-access-token',
      user,
    });
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
});
