import {
  Injectable,
  ServiceUnavailableException,
  type Provider,
} from '@nestjs/common';

export const INVITATION_MAILER = 'INVITATION_MAILER';

export type InvitationEmail = {
  acceptanceUrl: string;
  email: string;
  organizationName: string;
  role: string;
};

export interface InvitationMailer {
  sendInvitation(input: InvitationEmail): Promise<void>;
}

@Injectable()
export class DevelopmentInvitationMailer implements InvitationMailer {
  async sendInvitation(input: InvitationEmail): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'Production invitation email provider is not configured',
      );
    }

    console.log(
      `Invitation link for ${input.email} (${input.organizationName}, ${input.role}): ${input.acceptanceUrl}`,
    );
  }
}

export const invitationMailerProvider: Provider = {
  provide: INVITATION_MAILER,
  useClass: DevelopmentInvitationMailer,
};
