import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { DivisionModule } from './modules/division/division.module';
import { InvitationModule } from './modules/invitation/invitation.module';
import { LeagueSeasonModule } from './modules/league-season/league-season.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { OrganizationMemberModule } from './modules/organization-member/organization-member.module';
import { PlayerModule } from './modules/player/player.module';
import { PublicModule } from './modules/public/public.module';
import { RosterModule } from './modules/roster/roster.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { StandingsModule } from './modules/standings/standings.module';
import { TeamManagerWorkspaceModule } from './modules/team-manager-workspace/team-manager-workspace.module';
import { TeamModule } from './modules/team/team.module';
import { VenueModule } from './modules/venue/venue.module';
import { NotificationModule } from './modules/notification/notification.module';
import { CompetitionModule } from './modules/competition/competition.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    InvitationModule,
    PublicModule,
    RosterModule,
    ScheduleModule,
    ScoringModule,
    StandingsModule,
    TeamManagerWorkspaceModule,
    OrganizationModule,
    OrganizationMemberModule,
    LeagueSeasonModule,
    DivisionModule,
    TeamModule,
    PlayerModule,
    VenueModule,
    NotificationModule,
    CompetitionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
