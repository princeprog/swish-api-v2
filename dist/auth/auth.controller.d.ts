import type { Response } from 'express';
import { type AppConfig } from '../config/app.config';
import type { AuthenticatedRequest, CookieRequest } from './auth.request';
import { AuthService } from './auth.service';
import type { AuthSessionResult } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
type AuthResponse = {
    accessToken: string;
    user: AuthSessionResult['user'];
};
export declare class AuthController {
    private readonly authService;
    private readonly config?;
    constructor(authService: AuthService, config?: AppConfig | undefined);
    login(body: LoginDto, response: Response): Promise<AuthResponse>;
    logout(request: CookieRequest, response: Response): Promise<{
        success: boolean;
    }>;
    getMe(request: AuthenticatedRequest): {
        user: import("./auth.types").AuthUser;
    };
    refresh(request: CookieRequest, response: Response): Promise<AuthResponse>;
    register(body: RegisterDto, response: Response): Promise<AuthResponse>;
    private get authConfig();
    private cookieOptions;
    private getRefreshToken;
    private respondWithSession;
}
export {};
