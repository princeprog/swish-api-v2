import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { LeagueSeasonService } from './league-season.service';
import { LeagueSeasonController } from './league-season.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [LeagueSeasonController],
  providers: [LeagueSeasonService],
  exports: [LeagueSeasonService],
})
export class LeagueSeasonModule {}
