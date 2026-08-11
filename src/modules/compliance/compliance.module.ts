import { Module } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ComplianceController } from './compliance.controller';
import { ComplianceRepository } from './compliance.repository';
import { ComplianceService } from './compliance.service';
import {
  CLOUDINARY_CLIENT,
  CloudinaryComplianceStorage,
} from './cloudinary-compliance-storage';
import { COMPLIANCE_STORAGE } from './compliance-storage';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ComplianceController],
  providers: [
    ComplianceRepository,
    ComplianceService,
    CloudinaryComplianceStorage,
    {
      provide: COMPLIANCE_STORAGE,
      useExisting: CloudinaryComplianceStorage,
    },
    {
      provide: CLOUDINARY_CLIENT,
      useValue: cloudinary,
    },
  ],
  exports: [ComplianceService, COMPLIANCE_STORAGE],
})
export class ComplianceModule {}
