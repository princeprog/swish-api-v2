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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const auth_repository_1 = require("./auth.repository");
const password_service_1 = require("./password.service");
const token_service_1 = require("./token.service");
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function sanitizeName(name) {
    return name.trim();
}
let AuthService = class AuthService {
    authRepository;
    passwordService;
    tokenService;
    constructor(authRepository, passwordService, tokenService) {
        this.authRepository = authRepository;
        this.passwordService = passwordService;
        this.tokenService = tokenService;
    }
    getMe(user) {
        return { user };
    }
    async login(input) {
        const email = normalizeEmail(input.email);
        const user = await this.authRepository.findUserByEmail(email);
        if (!user) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const credential = await this.authRepository.findPasswordCredentialByUserId(user.id);
        if (!credential) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        const isValidPassword = await this.passwordService.verify(credential.password_hash, input.password);
        if (!isValidPassword) {
            throw new common_1.UnauthorizedException('Invalid email or password');
        }
        return this.createSessionResult(user);
    }
    async logout(refreshToken) {
        if (!refreshToken) {
            return;
        }
        const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
        const tokenRecord = await this.authRepository.findRefreshTokenByHash(tokenHash);
        if (tokenRecord) {
            await this.authRepository.revokeRefreshToken(tokenRecord.id);
        }
    }
    async refresh(refreshToken) {
        if (!refreshToken) {
            throw new common_1.UnauthorizedException('Missing refresh token');
        }
        const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
        const tokenRecord = await this.authRepository.findRefreshTokenByHash(tokenHash);
        if (!tokenRecord) {
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
        if (tokenRecord.revoked_at) {
            await this.authRepository.revokeSession(tokenRecord.session_id);
            throw new common_1.UnauthorizedException('Invalid refresh token');
        }
        if (tokenRecord.expires_at.getTime() <= Date.now()) {
            await this.authRepository.revokeRefreshToken(tokenRecord.id);
            throw new common_1.UnauthorizedException('Refresh token expired');
        }
        await this.authRepository.revokeRefreshToken(tokenRecord.id);
        return this.createSessionResult(tokenRecord.user, {
            rotatedFromTokenId: tokenRecord.id,
            sessionId: tokenRecord.session_id,
        });
    }
    async register(input) {
        const email = normalizeEmail(input.email);
        const existingUser = await this.authRepository.findUserByEmail(email);
        if (existingUser) {
            throw new common_1.ConflictException('Email is already registered');
        }
        const passwordHash = await this.passwordService.hash(input.password);
        const user = await this.authRepository.createUserWithPassword({
            email,
            name: sanitizeName(input.name),
            passwordHash,
        });
        return this.createSessionResult(user);
    }
    async createSessionResult(user, options = {}) {
        const tokens = await this.tokenService.issueSessionTokens(user, options);
        return {
            accessToken: tokens.accessToken,
            refreshCookieMaxAgeMs: this.tokenService.getRefreshCookieMaxAgeMs(),
            refreshToken: tokens.refreshToken,
            user,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_repository_1.AuthRepository,
        password_service_1.PasswordService,
        token_service_1.TokenService])
], AuthService);
//# sourceMappingURL=auth.service.js.map