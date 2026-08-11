import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DATABASE, type Database } from '../../database/database.tokens';
import { NotificationWriter } from './notification.writer';

const HOUR_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export function isNotificationReminderWindow(
  target: Date,
  now: Date,
  upperHours: number,
  lowerHours: number,
): boolean {
  const targetTime = new Date(target).getTime();
  const nowTime = new Date(now).getTime();

  return (
    targetTime > nowTime + lowerHours * HOUR_MS &&
    targetTime <= nowTime + upperHours * HOUR_MS
  );
}

export function notificationRetentionDate(expiry: Date): Date {
  return new Date(new Date(expiry).getTime() + 90 * 24 * HOUR_MS);
}

@Injectable()
export class NotificationJobsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly writer: NotificationWriter,
  ) {}

  onModuleInit(): void {
    if (process.env.NOTIFICATION_JOBS_ENABLED === 'false') {
      return;
    }

    void this.runSweep();
    this.timer = setInterval(() => void this.runSweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runSweep(now = new Date()) {
    const counts = {
      expiredInvitationActions: await this.clearExpiredInvitationActions(now),
      games: await this.createGameReminders(now),
      invitations: await this.createInvitationReminders(now),
      rosters: await this.createRosterReminders(now),
      compliance: await this.createComplianceReminders(now),
      removed: await this.removeExpiredNotifications(now),
    };

    return counts;
  }

  private async clearExpiredInvitationActions(now: Date): Promise<number> {
    const invitations = await (this.db as any)
      .selectFrom('access.organization_invitations')
      .select(['id'])
      .where('expires_at', '<=', now)
      .execute();

    for (const invitation of invitations) {
      await this.writer.clearInvitationActions(invitation.id);
    }

    return invitations.length;
  }

  private async createInvitationReminders(now: Date): Promise<number> {
    const invitations = await (this.db as any)
      .selectFrom('access.organization_invitations as invitations')
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'invitations.organization_id',
      )
      .select([
        'invitations.email',
        'invitations.expires_at',
        'invitations.id',
        'invitations.organization_id',
        'invitations.role',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('invitations.status', '=', 'pending')
      .where('invitations.expires_at', '>', now)
      .where(
        'invitations.expires_at',
        '<=',
        new Date(now.getTime() + 48 * HOUR_MS),
      )
      .execute();

    for (const invitation of invitations) {
      const user = await (this.db as any)
        .selectFrom('auth.users')
        .select(['id'])
        .where('email', '=', invitation.email)
        .executeTakeFirst();
      await this.writer.create({
        actionExpiresAt: invitation.expires_at,
        context: {
          invitationId: invitation.id,
          organizationName: invitation.organization_name,
          organizationSlug: invitation.organization_slug,
          roleLabel: invitation.role.replace('_', ' '),
        },
        dedupeKey: `invitation:${invitation.id}:expiring`,
        eventType: 'access.invitation_expiring',
        organizationId: invitation.organization_id,
        recipients: user
          ? [{ userId: user.id }]
          : [{ email: invitation.email }],
        resourceId: invitation.id,
        resourceType: 'invitation',
        retainUntil: notificationRetentionDate(invitation.expires_at),
      });
    }

    return invitations.length;
  }

  private async createGameReminders(now: Date): Promise<number> {
    const games = await (this.db as any)
      .selectFrom('admin.schedule_games as games')
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'games.organization_id',
      )
      .select([
        'games.id',
        'games.organization_id',
        'games.home_team_id',
        'games.away_team_id',
        'games.home_team_name',
        'games.away_team_name',
        'games.starts_at',
        'games.status',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('games.status', 'in', ['scheduled', 'postponed'])
      .where('games.starts_at', '>', now)
      .where('games.starts_at', '<=', new Date(now.getTime() + 24 * HOUR_MS))
      .execute();
    let created = 0;

    for (const game of games) {
      const is24Hour = isNotificationReminderWindow(game.starts_at, now, 24, 1);
      const isOneHour = isNotificationReminderWindow(game.starts_at, now, 1, 0);
      if (!is24Hour && !isOneHour) {
        continue;
      }

      const recipients = await this.findGameRecipients(game.id);
      if (recipients.length) {
        await this.writer.create({
          context: {
            gameId: game.id,
            gameLabel: `${game.home_team_name ?? 'Home'} vs ${game.away_team_name ?? 'Away'}`,
            organizationName: game.organization_name ?? 'your league',
            organizationSlug: game.organization_slug,
            reminderLabel: isOneHour ? 'in about one hour' : 'within 24 hours',
          },
          dedupeKey: `game:${game.id}:reminder:${isOneHour ? '1h' : '24h'}`,
          eventType: 'schedule.game_reminder',
          organizationId: game.organization_id,
          recipients,
          resourceId: game.id,
          resourceType: 'game',
        });
        created += 1;
      }

      const scorekeeperAssignment = await (this.db as any)
        .selectFrom('access.game_scorekeeper_assignments')
        .select(['id'])
        .where('game_id', '=', game.id)
        .executeTakeFirst();
      if (is24Hour && !scorekeeperAssignment) {
        const administrators = await this.findAdministrators(
          game.organization_id,
        );
        await this.writer.create({
          context: {
            gameId: game.id,
            gameLabel: `${game.home_team_name ?? 'Home'} vs ${game.away_team_name ?? 'Away'}`,
            organizationName: game.organization_name ?? 'your league',
            organizationSlug: game.organization_slug,
          },
          dedupeKey: `game:${game.id}:unassigned-scorekeeper:24h`,
          eventType: 'schedule.unassigned_game_reminder',
          organizationId: game.organization_id,
          recipients: administrators,
          resourceId: game.id,
          resourceType: 'game',
        });
        created += administrators.length ? 1 : 0;
      }
    }

    return created;
  }

  private async createRosterReminders(now: Date): Promise<number> {
    const settings = await (this.db as any)
      .selectFrom('admin.division_roster_settings as settings')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'settings.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'seasons.organization_id',
      )
      .select([
        'settings.division_id',
        'settings.submission_deadline_at',
        'seasons.organization_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
      ])
      .where('settings.submission_deadline_at', 'is not', null)
      .where(
        'settings.submission_deadline_at',
        '<=',
        new Date(now.getTime() + 72 * HOUR_MS),
      )
      .execute();
    let created = 0;

    for (const setting of settings) {
      const teams = await (this.db as any)
        .selectFrom('admin.teams as teams')
        .select(['teams.id', 'teams.name'])
        .where('teams.division_id', '=', setting.division_id)
        .where('teams.status', '=', 'active')
        .execute();
      for (const team of teams) {
        const managers = await (this.db as any)
          .selectFrom('access.team_manager_assignments as assignments')
          .innerJoin(
            'admin.organization_members as members',
            'members.id',
            'assignments.organization_member_id',
          )
          .select(['members.user_id'])
          .where('assignments.team_id', '=', team.id)
          .where('members.status', '=', 'active')
          .execute();
        const deadline = new Date(setting.submission_deadline_at);
        const is72 = isNotificationReminderWindow(deadline, now, 72, 24);
        const is24 = isNotificationReminderWindow(deadline, now, 24, 0);
        const overdue = deadline <= now;
        if (is72 || is24) {
          await this.writer.create({
            context: {
              deadlineLabel: deadline.toLocaleString(),
              organizationName: setting.organization_name,
              organizationSlug: setting.organization_slug,
              rosterLabel: `${team.name} roster`,
            },
            dedupeKey: `roster:${team.id}:deadline:${is24 ? '24h' : '72h'}`,
            eventType: 'roster.deadline_reminder',
            organizationId: setting.organization_id,
            recipients: managers.map((row: { user_id: string }) => ({
              userId: row.user_id,
            })),
            resourceId: team.id,
            resourceType: 'team_roster',
          });
          created += managers.length ? 1 : 0;
        }
        if (overdue) {
          const administrators = await this.findAdministrators(
            setting.organization_id,
          );
          await this.writer.create({
            context: {
              deadlineLabel: deadline.toLocaleString(),
              organizationName: setting.organization_name,
              organizationSlug: setting.organization_slug,
              rosterLabel: `${team.name} roster`,
            },
            dedupeKey: `roster:${team.id}:overdue`,
            eventType: 'roster.overdue',
            organizationId: setting.organization_id,
            recipients: [
              ...managers.map((row: { user_id: string }) => ({
                userId: row.user_id,
              })),
              ...administrators,
            ],
            resourceId: team.id,
            resourceType: 'team_roster',
          });
          created += managers.length || administrators.length ? 1 : 0;
        }
      }
    }

    return created;
  }

  private async createComplianceReminders(now: Date): Promise<number> {
    const settings = await (this.db as any)
      .selectFrom('compliance.division_settings as settings')
      .innerJoin(
        'admin.divisions as divisions',
        'divisions.id',
        'settings.division_id',
      )
      .innerJoin(
        'admin.league_seasons as seasons',
        'seasons.id',
        'divisions.league_season_id',
      )
      .innerJoin(
        'admin.organizations as organizations',
        'organizations.id',
        'seasons.organization_id',
      )
      .select([
        'settings.id',
        'settings.division_id',
        'settings.submission_deadline_at',
        'seasons.organization_id',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
        'divisions.name as division_name',
      ])
      .where('settings.status', '=', 'published')
      .where('settings.submission_deadline_at', 'is not', null)
      .where(
        'settings.submission_deadline_at',
        '<=',
        new Date(now.getTime() + 72 * HOUR_MS),
      )
      .execute();
    let created = 0;

    for (const setting of settings) {
      const deadline = new Date(setting.submission_deadline_at);
      const is72 = isNotificationReminderWindow(deadline, now, 72, 24);
      const is24 = isNotificationReminderWindow(deadline, now, 24, 0);
      const overdue = deadline <= now;
      if (!is72 && !is24 && !overdue) continue;

      const teams = await (this.db as any)
        .selectFrom('admin.teams as teams')
        .leftJoin(
          'compliance.team_clearance_projections as projections',
          (join: any) =>
            join
              .onRef('projections.team_id', '=', 'teams.id')
              .on('projections.division_settings_id', '=', setting.id),
        )
        .select([
          'teams.id',
          'teams.name',
          'projections.status as clearance_status',
        ])
        .where('teams.division_id', '=', setting.division_id)
        .where('teams.status', '=', 'active')
        .execute();
      for (const team of teams) {
        if (team.clearance_status === 'cleared') continue;
        const managers = await (this.db as any)
          .selectFrom('access.team_manager_assignments as assignments')
          .innerJoin(
            'admin.organization_members as members',
            'members.id',
            'assignments.organization_member_id',
          )
          .select(['members.user_id'])
          .where('assignments.team_id', '=', team.id)
          .where('members.status', '=', 'active')
          .execute();
        if (managers.length === 0) continue;
        await this.writer.create({
          context: {
            deadlineLabel: deadline.toLocaleString('en-PH', {
              timeZone: 'Asia/Manila',
            }),
            divisionId: setting.division_id,
            divisionName: setting.division_name,
            organizationName: setting.organization_name,
            organizationSlug: setting.organization_slug,
            teamId: team.id,
            teamName: team.name,
          },
          dedupeKey: `compliance:${setting.id}:${team.id}:deadline:${overdue ? 'overdue' : is24 ? '24h' : '72h'}`,
          eventType: 'compliance.deadline_reminder',
          organizationId: setting.organization_id,
          recipients: managers.map((row: { user_id: string }) => ({
            userId: row.user_id,
          })),
          resourceId: team.id,
          resourceType: 'compliance_team',
        });
        created += 1;
      }
    }

    return created;
  }

  private async findGameRecipients(gameId: string) {
    const game = await (this.db as any)
      .selectFrom('competition.games')
      .select(['home_team_id', 'away_team_id'])
      .where('id', '=', gameId)
      .executeTakeFirst();
    if (!game) {
      return [];
    }

    const managers = await (this.db as any)
      .selectFrom('access.team_manager_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.team_id', 'in', [
        game.home_team_id,
        game.away_team_id,
      ])
      .where('members.status', '=', 'active')
      .execute();
    const scorekeepers = await (this.db as any)
      .selectFrom('access.game_scorekeeper_assignments as assignments')
      .innerJoin(
        'admin.organization_members as members',
        'members.id',
        'assignments.organization_member_id',
      )
      .select(['members.user_id'])
      .where('assignments.game_id', '=', gameId)
      .where('members.status', '=', 'active')
      .execute();

    return [
      ...managers.map((row: { user_id: string }) => ({ userId: row.user_id })),
      ...scorekeepers.map((row: { user_id: string }) => ({
        userId: row.user_id,
      })),
    ];
  }

  private async findAdministrators(organizationId: string) {
    const rows = await (this.db as any)
      .selectFrom('admin.organization_members')
      .select(['user_id'])
      .where('organization_id', '=', organizationId)
      .where('status', '=', 'active')
      .where('role', 'in', ['owner', 'admin'])
      .execute();

    return rows.map((row: { user_id: string }) => ({ userId: row.user_id }));
  }

  private async removeExpiredNotifications(now: Date): Promise<number> {
    const result = await (this.db as any)
      .deleteFrom('notification.notifications')
      .where('retain_until', '<', now)
      .executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0);
  }
}
