import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CompetitionController } from './competition.controller';
import { CompetitionRepository } from './competition.repository';
import { CompetitionService } from './competition.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { OfficialResultModule } from '../official-result/official-result.module';

@Module({
  imports: [DatabaseModule, AuthModule, ScheduleModule, OfficialResultModule],
  controllers: [CompetitionController],
  providers: [CompetitionRepository, CompetitionService],
  exports: [CompetitionService],
})
export class CompetitionModule {}
