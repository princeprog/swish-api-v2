import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationMembership } from '../common/auth/roles';
import { DATABASE, type Database } from '../database/database.tokens';
import type { AuthPasswordCredentials } from '../database/db';
import type { AuthUser, RefreshTokenRecord } from './auth.types';

type CreateUserWithPasswordInput = {
  email: string;
  name: string;
  passwordHash: string;
};

type CreateRefreshTokenInput = {
  expiresAt: Date;
  rotatedFromTokenId?: string;
  sessionId: string;
  tokenHash: string;
  userId: string;
};

function toAuthUser(user: {
  email: string;
  id: string;
  name: string;
}): AuthUser {
  return {
    email: user.email,
    id: user.id,
    name: user.name,
  };
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async createRefreshToken(input: CreateRefreshTokenInput): Promise<void> {
    await this.db
      .insertInto('auth.refresh_tokens')
      .values({
        expires_at: input.expiresAt,
        rotated_from_token_id: input.rotatedFromTokenId,
        session_id: input.sessionId,
        token_hash: input.tokenHash,
        user_id: input.userId,
      })
      .execute();
  }

  async createSession(
    userId: string,
    sessionTokenHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }> {
    const session = await this.db
      .insertInto('auth.auth_sessions')
      .values({
        expires_at: expiresAt,
        session_token_hash: sessionTokenHash,
        user_id: userId,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    return session;
  }

  async createUserWithPassword(
    input: CreateUserWithPasswordInput,
  ): Promise<AuthUser> {
    const user = await this.db.transaction().execute(async (trx) => {
      const createdUser = await trx
        .insertInto('auth.users')
        .values({
          email: input.email,
          name: input.name,
        })
        .returning(['email', 'id', 'name'])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('auth.password_credentials')
        .values({
          password_hash: input.passwordHash,
          user_id: createdUser.id,
        })
        .execute();

      return createdUser;
    });

    return toAuthUser(user);
  }

  async findPasswordCredentialByUserId(
    userId: string,
  ): Promise<
    Pick<AuthPasswordCredentials, 'password_hash' | 'user_id'> | undefined
  > {
    return this.db
      .selectFrom('auth.password_credentials')
      .select(['password_hash', 'user_id'])
      .where('user_id', '=', userId)
      .executeTakeFirst();
  }

  async findRefreshTokenByHash(
    tokenHash: string,
  ): Promise<RefreshTokenRecord | undefined> {
    const record = await this.db
      .selectFrom('auth.refresh_tokens as refresh_tokens')
      .innerJoin('auth.users as users', 'users.id', 'refresh_tokens.user_id')
      .select([
        'refresh_tokens.expires_at',
        'refresh_tokens.id',
        'refresh_tokens.revoked_at',
        'refresh_tokens.session_id',
        'refresh_tokens.user_id',
        'users.email',
        'users.name',
      ])
      .where('refresh_tokens.token_hash', '=', tokenHash)
      .executeTakeFirst();

    if (!record) {
      return undefined;
    }

    return {
      expires_at: record.expires_at,
      id: record.id,
      revoked_at: record.revoked_at,
      session_id: record.session_id,
      user: {
        email: record.email,
        id: record.user_id,
        name: record.name,
      },
      user_id: record.user_id,
    };
  }

  async findUserByEmail(email: string): Promise<AuthUser | undefined> {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['email', 'id', 'name'])
      .where('email', '=', email)
      .executeTakeFirst();

    return user ? toAuthUser(user) : undefined;
  }

  async findUserById(id: string): Promise<AuthUser | undefined> {
    const user = await this.db
      .selectFrom('auth.users')
      .select(['email', 'id', 'name'])
      .where('id', '=', id)
      .executeTakeFirst();

    return user ? toAuthUser(user) : undefined;
  }

  async findActiveOrganizationMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | undefined> {
    const membership = await this.db
      .selectFrom('admin.organization_members')
      .select(['organization_id', 'role', 'status', 'user_id'])
      .where('organization_id', '=', organizationId)
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .executeTakeFirst();

    return membership as OrganizationMembership | undefined;
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.db
      .updateTable('auth.refresh_tokens')
      .set({
        revoked_at: new Date(),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = new Date();

    await this.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('auth.auth_sessions')
        .set({
          revoked_at: now,
          updated_at: now,
        })
        .where('id', '=', sessionId)
        .execute();

      await trx
        .updateTable('auth.refresh_tokens')
        .set({
          revoked_at: now,
          updated_at: now,
        })
        .where('session_id', '=', sessionId)
        .where('revoked_at', 'is', null)
        .execute();
    });
  }
}
