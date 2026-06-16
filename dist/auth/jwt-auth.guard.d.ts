import { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';
export declare class JwtAuthGuard implements CanActivate {
    private readonly authRepository;
    private readonly tokenService;
    constructor(authRepository: AuthRepository, tokenService: TokenService);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
