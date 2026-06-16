import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { VenueService } from './venue.service';
import { VenueController } from './venue.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [VenueController],
  providers: [VenueService],
  exports: [VenueService],
})
export class VenueModule {}
