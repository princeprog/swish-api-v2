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
import { ScheduleModule } from './modules/schedule/schedule.module';
import { StandingsModule } from './modules/standings/standings.module';
import { TeamModule } from './modules/team/team.module';
import { VenueModule } from './modules/venue/venue.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
    InvitationModule,
    PublicModule,
    ScheduleModule,
    StandingsModule,
    OrganizationModule,
    OrganizationMemberModule,
    LeagueSeasonModule,
    DivisionModule,
    TeamModule,
    PlayerModule,
    VenueModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
