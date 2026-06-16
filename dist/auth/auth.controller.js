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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const app_config_1 = require("../config/app.config");
const auth_service_1 = require("./auth.service");
const login_dto_1 = require("./dto/login.dto");
const register_dto_1 = require("./dto/register.dto");
const jwt_auth_guard_1 = require("./jwt-auth.guard");
function defaultAuthConfig() {
    return {
        accessTokenExpiresIn: '15m',
        accessTokenSecret: '',
        refreshCookieName: 'swish_refresh_token',
        refreshTokenExpiresIn: '30d',
        refreshTokenSecret: '',
        secureCookies: false,
    };
}
let AuthController = class AuthController {
    authService;
    config;
    constructor(authService, config) {
        this.authService = authService;
        this.config = config;
    }
    async login(body, response) {
        return this.respondWithSession(await this.authService.login(body), response);
    }
    async logout(request, response) {
        await this.authService.logout(this.getRefreshToken(request));
        response.clearCookie(this.authConfig.refreshCookieName, this.cookieOptions());
        return { success: true };
    }
    getMe(request) {
        return this.authService.getMe(request.user);
    }
    async refresh(request, response) {
        return this.respondWithSession(await this.authService.refresh(this.getRefreshToken(request)), response);
    }
    async register(body, response) {
        return this.respondWithSession(await this.authService.register(body), response);
    }
    get authConfig() {
        return this.config?.auth ?? defaultAuthConfig();
    }
    cookieOptions(maxAge) {
        return {
            httpOnly: true,
            maxAge,
            path: '/',
            sameSite: 'lax',
            secure: this.authConfig.secureCookies,
        };
    }
    getRefreshToken(request) {
        return request.cookies?.[this.authConfig.refreshCookieName];
    }
    respondWithSession(result, response) {
        response.cookie(this.authConfig.refreshCookieName, result.refreshToken, this.cookieOptions(result.refreshCookieMaxAgeMs));
        return {
            accessToken: result.accessToken,
            user: result.user,
        };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "getMe", null);
__decorate([
    (0, common_1.Post)('refresh'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __param(1, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __metadata("design:paramtypes", [auth_service_1.AuthService, Object])
], AuthController);
//# sourceMappingURL=auth.controller.js.map