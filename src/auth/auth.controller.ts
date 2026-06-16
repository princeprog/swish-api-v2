import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import type { AuthenticatedRequest, CookieRequest } from './auth.request';
import { AuthService } from './auth.service';
import type { AuthSessionResult } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthResponse = {
  accessToken: string;
  user: AuthSessionResult['user'];
};

function defaultAuthConfig(): AppConfig['auth'] {
  return {
    accessTokenExpiresIn: '15m',
    accessTokenSecret: '',
    refreshCookieName: 'swish_refresh_token',
    refreshTokenExpiresIn: '30d',
    refreshTokenSecret: '',
    secureCookies: false,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWithSession(
      await this.authService.login(body),
      response,
    );
  }

  @Post('logout')
  async logout(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(this.getRefreshToken(request));
    response.clearCookie(
      this.authConfig.refreshCookieName,
      this.cookieOptions(),
    );

    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() request: AuthenticatedRequest) {
    return this.authService.getMe(request.user);
  }

  @Post('refresh')
  async refresh(
    @Req() request: CookieRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWithSession(
      await this.authService.refresh(this.getRefreshToken(request)),
      response,
    );
  }

  @Post('register')
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWithSession(
      await this.authService.register(body),
      response,
    );
  }

  private get authConfig(): AppConfig['auth'] {
    return this.config?.auth ?? defaultAuthConfig();
  }

  private cookieOptions(maxAge?: number) {
    return {
      httpOnly: true,
      maxAge,
      path: '/',
      sameSite: 'lax' as const,
      secure: this.authConfig.secureCookies,
    };
  }

  private getRefreshToken(request: CookieRequest): string | undefined {
    return request.cookies?.[this.authConfig.refreshCookieName];
  }

  private respondWithSession(
    result: AuthSessionResult,
    response: Response,
  ): AuthResponse {
    response.cookie(
      this.authConfig.refreshCookieName,
      result.refreshToken,
      this.cookieOptions(result.refreshCookieMaxAgeMs),
    );

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }
}
