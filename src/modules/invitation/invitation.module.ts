import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { InvitationController } from './invitation.controller';
import { invitationMailerProvider } from './invitation-mailer';
import { InvitationService } from './invitation.service';
import { InvitationTokenService } from './invitation-token.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [InvitationController],
  providers: [
    invitationMailerProvider,
    InvitationService,
    InvitationTokenService,
  ],
})
export class InvitationModule {}
