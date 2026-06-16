import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) response: Response) {
    const readiness = await this.healthService.getReadiness();

    if (readiness.status === 'error') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return readiness;
  }
}
