"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthRepository = void 0;
const common_1 = require("@nestjs/common");
const database_tokens_1 = require("../database/database.tokens");
function toAuthUser(user) {
    return {
        email: user.email,
        id: user.id,
        name: user.name,
    };
}
let AuthRepository = class AuthRepository {
    db;
    constructor(db) {
        this.db = db;
    }
    async createRefreshToken(input) {
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
    async createSession(userId, sessionTokenHash, expiresAt) {
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
    async createUserWithPassword(input) {
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
    async findPasswordCredentialByUserId(userId) {
        return this.db
            .selectFrom('auth.password_credentials')
            .select(['password_hash', 'user_id'])
            .where('user_id', '=', userId)
            .executeTakeFirst();
    }
    async findRefreshTokenByHash(tokenHash) {
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
    async findUserByEmail(email) {
        const user = await this.db
            .selectFrom('auth.users')
            .select(['email', 'id', 'name'])
            .where('email', '=', email)
            .executeTakeFirst();
        return user ? toAuthUser(user) : undefined;
    }
    async findUserById(id) {
        const user = await this.db
            .selectFrom('auth.users')
            .select(['email', 'id', 'name'])
            .where('id', '=', id)
            .executeTakeFirst();
        return user ? toAuthUser(user) : undefined;
    }
    async revokeRefreshToken(id) {
        await this.db
            .updateTable('auth.refresh_tokens')
            .set({
            revoked_at: new Date(),
            updated_at: new Date(),
        })
            .where('id', '=', id)
            .execute();
    }
    async revokeSession(sessionId) {
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
};
exports.AuthRepository = AuthRepository;
exports.AuthRepository = AuthRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_tokens_1.DATABASE)),
    __metadata("design:paramtypes", [Object])
], AuthRepository);
//# sourceMappingURL=auth.repository.js.map