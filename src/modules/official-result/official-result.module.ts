import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { NotificationModule } from '../notification/notification.module';
import { OfficialResultCoordinator } from './official-result.service';

@Module({
  imports: [DatabaseModule, NotificationModule],
  providers: [OfficialResultCoordinator],
  exports: [OfficialResultCoordinator],
})
export class OfficialResultModule {}
