import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { RosterModule } from '../roster/roster.module';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';

@Module({
  imports: [DatabaseModule, AuthModule, RosterModule],
  controllers: [PlayerController],
  providers: [PlayerService],
  exports: [PlayerService],
})
export class PlayerModule {}
