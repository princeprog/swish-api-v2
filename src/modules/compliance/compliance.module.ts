import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceRepository } from './compliance.repository';
import { ComplianceService } from './compliance.service';
import {
  COMPLIANCE_STORAGE,
  PlaceholderComplianceStorage,
} from './compliance-storage';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ComplianceController],
  providers: [
    ComplianceRepository,
    ComplianceService,
    PlaceholderComplianceStorage,
    {
      provide: COMPLIANCE_STORAGE,
      useExisting: PlaceholderComplianceStorage,
    },
  ],
  exports: [ComplianceService, COMPLIANCE_STORAGE],
})
export class ComplianceModule {}
