import type { JwtSignOptions } from '@nestjs/jwt';
import { createDatabasePoolConfig } from '../database/database.config';
export declare const APP_CONFIG = "APP_CONFIG";
type AppEnvironment = 'development' | 'production' | 'test';
type JwtDuration = NonNullable<JwtSignOptions['expiresIn']>;
export type AppConfig = {
    app: {
        environment: AppEnvironment;
        port: number;
        serviceName: string;
    };
    auth: {
        accessTokenExpiresIn: JwtDuration;
        accessTokenSecret: string;
        refreshCookieName: string;
        refreshTokenExpiresIn: string;
        refreshTokenSecret: string;
        secureCookies: boolean;
    };
    database: ReturnType<typeof createDatabasePoolConfig>;
};
export declare function createAppConfig(env: NodeJS.ProcessEnv): AppConfig;
export {};
