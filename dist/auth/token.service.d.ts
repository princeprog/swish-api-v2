import { JwtService } from '@nestjs/jwt';
import { type AppConfig } from '../config/app.config';
import { AuthRepository } from './auth.repository';
import type { AccessTokenPayload, AuthUser } from './auth.types';
type IssueSessionTokenOptions = {
    rotatedFromTokenId?: string;
    sessionId?: string;
};
type IssuedSessionTokens = {
    accessToken: string;
    refreshToken: string;
};
export declare class TokenService {
    private readonly authRepository;
    private readonly jwtService;
    private readonly config;
    constructor(authRepository: AuthRepository, jwtService: JwtService, config: AppConfig);
    getRefreshCookieMaxAgeMs(): number;
    hashRefreshToken(refreshToken: string): string;
    issueSessionTokens(user: AuthUser, options?: IssueSessionTokenOptions): Promise<IssuedSessionTokens>;
    signAccessToken(user: AuthUser): Promise<string>;
    verifyAccessToken(token: string): Promise<AccessTokenPayload>;
}
export {};
