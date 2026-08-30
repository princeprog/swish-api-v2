import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { CompetitionController } from './competition.controller';
import { CompetitionRepository } from './competition.repository';
import { CompetitionService } from './competition.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CompetitionController],
  providers: [CompetitionRepository, CompetitionService],
  exports: [CompetitionService],
})
export class CompetitionModule {}
