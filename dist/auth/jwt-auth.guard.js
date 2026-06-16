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
exports.JwtAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const auth_repository_1 = require("./auth.repository");
const token_service_1 = require("./token.service");
function extractBearerToken(header) {
    const [scheme, token] = header?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
        return undefined;
    }
    return token;
}
let JwtAuthGuard = class JwtAuthGuard {
    authRepository;
    tokenService;
    constructor(authRepository, tokenService) {
        this.authRepository = authRepository;
        this.tokenService = tokenService;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const token = extractBearerToken(request.headers.authorization);
        if (!token) {
            throw new common_1.UnauthorizedException('Missing access token');
        }
        const payload = await this.tokenService.verifyAccessToken(token);
        const user = await this.authRepository.findUserById(payload.sub);
        if (!user) {
            throw new common_1.UnauthorizedException('Invalid access token');
        }
        request.user = user;
        return true;
    }
};
exports.JwtAuthGuard = JwtAuthGuard;
exports.JwtAuthGuard = JwtAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [auth_repository_1.AuthRepository,
        token_service_1.TokenService])
], JwtAuthGuard);
//# sourceMappingURL=jwt-auth.guard.js.map