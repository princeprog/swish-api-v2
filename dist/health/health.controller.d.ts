import type { Response } from 'express';
import { HealthService } from './health.service';
export declare class HealthController {
    private readonly healthService;
    constructor(healthService: HealthService);
    getHealth(): import("./health.service").HealthResponse;
    getReadiness(response: Response): Promise<import("./health.service").HealthResponse>;
}
