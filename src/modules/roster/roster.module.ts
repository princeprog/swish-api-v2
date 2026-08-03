import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [RosterController],
  providers: [RosterService],
  exports: [RosterService],
})
export class RosterModule {}
