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
exports.TokenService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const crypto_1 = require("crypto");
const app_config_1 = require("../config/app.config");
const auth_repository_1 = require("./auth.repository");
function parseDurationToMs(duration) {
    const match = /^(\d+)([smhd])$/.exec(duration);
    if (!match) {
        throw new Error(`Unsupported duration format: ${duration}`);
    }
    const amount = Number(match[1]);
    const unit = match[2];
    const multipliers = {
        d: 24 * 60 * 60 * 1000,
        h: 60 * 60 * 1000,
        m: 60 * 1000,
        s: 1000,
    };
    return amount * multipliers[unit];
}
function randomToken() {
    return (0, crypto_1.randomBytes)(64).toString('base64url');
}
let TokenService = class TokenService {
    authRepository;
    jwtService;
    config;
    constructor(authRepository, jwtService, config) {
        this.authRepository = authRepository;
        this.jwtService = jwtService;
        this.config = config;
    }
    getRefreshCookieMaxAgeMs() {
        return parseDurationToMs(this.config.auth.refreshTokenExpiresIn);
    }
    hashRefreshToken(refreshToken) {
        return (0, crypto_1.createHash)('sha256')
            .update(refreshToken)
            .update(this.config.auth.refreshTokenSecret)
            .digest('hex');
    }
    async issueSessionTokens(user, options = {}) {
        const refreshToken = randomToken();
        const refreshTokenHash = this.hashRefreshToken(refreshToken);
        const expiresAt = new Date(Date.now() + this.getRefreshCookieMaxAgeMs());
        const sessionId = options.sessionId ??
            (await this.authRepository.createSession(user.id, (0, crypto_1.createHash)('sha256').update(randomToken()).digest('hex'), expiresAt)).id;
        await this.authRepository.createRefreshToken({
            expiresAt,
            rotatedFromTokenId: options.rotatedFromTokenId,
            sessionId,
            tokenHash: refreshTokenHash,
            userId: user.id,
        });
        return {
            accessToken: await this.signAccessToken(user),
            refreshToken,
        };
    }
    async signAccessToken(user) {
        return this.jwtService.signAsync({
            email: user.email,
            sub: user.id,
        }, {
            expiresIn: this.config.auth.accessTokenExpiresIn,
            secret: this.config.auth.accessTokenSecret,
        });
    }
    async verifyAccessToken(token) {
        try {
            return await this.jwtService.verifyAsync(token, {
                secret: this.config.auth.accessTokenSecret,
            });
        }
        catch {
            throw new common_1.UnauthorizedException('Invalid access token');
        }
    }
};
exports.TokenService = TokenService;
exports.TokenService = TokenService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __metadata("design:paramtypes", [auth_repository_1.AuthRepository,
        jwt_1.JwtService, Object])
], TokenService);
//# sourceMappingURL=token.service.js.map