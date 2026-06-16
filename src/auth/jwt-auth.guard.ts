import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import type { AuthenticatedRequest } from './auth.request';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const payload = await this.tokenService.verifyAccessToken(token);
    const user = await this.authRepository.findUserById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }

    request.user = user;

    return true;
  }
}
