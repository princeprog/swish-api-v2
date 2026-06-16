import { createDatabasePoolConfig } from '../database/database.config';
export declare const APP_CONFIG = "APP_CONFIG";
type AppEnvironment = 'development' | 'production' | 'test';
export type AppConfig = {
    app: {
        environment: AppEnvironment;
        port: number;
        serviceName: string;
    };
    auth: {
        accessTokenExpiresIn: string;
        refreshCookieName: string;
        refreshTokenExpiresIn: string;
        secureCookies: boolean;
    };
    database: ReturnType<typeof createDatabasePoolConfig>;
};
export declare function createAppConfig(env: NodeJS.ProcessEnv): AppConfig;
export {};
