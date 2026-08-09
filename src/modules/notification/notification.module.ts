import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationWriter } from './notification.writer';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationWriter],
  exports: [NotificationService, NotificationWriter],
})
export class NotificationModule {}
