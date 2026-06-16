import { type AppConfig } from '../config/app.config';
import { type Database } from '../database/database.tokens';
type HealthCheckState = 'configured' | 'error' | 'ok';
type HealthStatus = 'error' | 'ok';
export type HealthResponse = {
    checks: {
        config: HealthCheckState;
        database: HealthCheckState;
    };
    environment: string;
    service: string;
    status: HealthStatus;
    timestamp: string;
    uptime: number;
};
export declare class HealthService {
    private readonly config;
    private readonly db;
    constructor(config: AppConfig, db: Database);
    getHealth(): HealthResponse;
    getReadiness(): Promise<HealthResponse>;
}
export {};
