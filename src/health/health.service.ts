import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app.config';
import { DATABASE, type Database } from '../database/database.tokens';

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

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  getHealth(): HealthResponse {
    return {
      checks: {
        config: 'ok',
        database: 'configured',
      },
      environment: this.config.app.environment,
      service: this.config.app.serviceName,
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }

  async getReadiness(): Promise<HealthResponse> {
    try {
      await this.db
        .selectNoFrom((expressionBuilder) =>
          expressionBuilder.val(1).as('ok'),
        )
        .executeTakeFirst();

      return {
        ...this.getHealth(),
        checks: {
          config: 'ok',
          database: 'ok',
        },
      };
    } catch {
      return {
        ...this.getHealth(),
        checks: {
          config: 'ok',
          database: 'error',
        },
        status: 'error',
      };
    }
  }
}
