import { type Database } from '../database/database.tokens';
import type { AuthPasswordCredentials } from '../database/db';
import type { AuthUser, RefreshTokenRecord } from './auth.types';
type CreateUserWithPasswordInput = {
    email: string;
    name: string;
    passwordHash: string;
};
type CreateRefreshTokenInput = {
    expiresAt: Date;
    rotatedFromTokenId?: string;
    sessionId: string;
    tokenHash: string;
    userId: string;
};
export declare class AuthRepository {
    private readonly db;
    constructor(db: Database);
    createRefreshToken(input: CreateRefreshTokenInput): Promise<void>;
    createSession(userId: string, sessionTokenHash: string, expiresAt: Date): Promise<{
        id: string;
    }>;
    createUserWithPassword(input: CreateUserWithPasswordInput): Promise<AuthUser>;
    findPasswordCredentialByUserId(userId: string): Promise<Pick<AuthPasswordCredentials, 'password_hash' | 'user_id'> | undefined>;
    findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRecord | undefined>;
    findUserByEmail(email: string): Promise<AuthUser | undefined>;
    findUserById(id: string): Promise<AuthUser | undefined>;
    revokeRefreshToken(id: string): Promise<void>;
    revokeSession(sessionId: string): Promise<void>;
}
export {};
