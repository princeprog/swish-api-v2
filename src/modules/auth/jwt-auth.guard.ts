import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import type { AuthenticatedRequest } from './auth.request';
import { APP_CONFIG, type AppConfig } from '../../config/app.config';
import { Inject } from '@nestjs/common';
import { TokenService } from './token.service';

function extractBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token) {
    return undefined;
  }

  return token;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    @Inject(APP_CONFIG) private readonly config?: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token =
      request.cookies?.[this.accessCookieName] ??
      extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.tokenService.verifyAccessToken(token);
    if (!payload.sid) {
      throw new UnauthorizedException('Invalid access token');
    }

    const session = await this.authRepository.findActiveSessionForUser(
      payload.sid,
      payload.sub,
    );

    if (!session) {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.authRepository.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    request.user = user;

    return true;
  }

  private get accessCookieName(): string {
    return this.config?.auth.accessCookieName ?? 'swish_access_token';
  }
}
