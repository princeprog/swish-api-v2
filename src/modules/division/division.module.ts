import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { DivisionService } from './division.service';
import { DivisionController } from './division.controller';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [DivisionController],
  providers: [DivisionService],
  exports: [DivisionService],
})
export class DivisionModule {}
