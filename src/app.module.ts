import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { DivisionModule } from './modules/division/division.module';
import { LeagueSeasonModule } from './modules/league-season/league-season.module';
import { OrganizationMemberModule } from './modules/organization-member/organization-member.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { PlayerModule } from './modules/player/player.module';
import { TeamModule } from './modules/team/team.module';
import { VenueModule } from './modules/venue/venue.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    AuthModule,
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
