import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { TeamManagerWorkspaceController } from './team-manager-workspace.controller';
import { TeamManagerWorkspaceService } from './team-manager-workspace.service';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [TeamManagerWorkspaceController],
  providers: [TeamManagerWorkspaceService],
})
export class TeamManagerWorkspaceModule {}
