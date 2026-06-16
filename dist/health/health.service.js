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
exports.HealthService = void 0;
const common_1 = require("@nestjs/common");
const app_config_1 = require("../config/app.config");
const database_tokens_1 = require("../database/database.tokens");
let HealthService = class HealthService {
    config;
    db;
    constructor(config, db) {
        this.config = config;
        this.db = db;
    }
    getHealth() {
        return {
            checks: {
                config: 'ok',
                database: 'configured',
            },
            environment: this.config.app.environment,
            service: this.config.app.serviceName,
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    }
    async getReadiness() {
        try {
            await this.db
                .selectNoFrom((expressionBuilder) => expressionBuilder.val(1).as('ok'))
                .executeTakeFirst();
            return {
                ...this.getHealth(),
                checks: {
                    config: 'ok',
                    database: 'ok',
                },
            };
        }
        catch {
            return {
                ...this.getHealth(),
                checks: {
                    config: 'ok',
                    database: 'error',
                },
                status: 'error',
            };
        }
    }
};
exports.HealthService = HealthService;
exports.HealthService = HealthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __param(1, (0, common_1.Inject)(database_tokens_1.DATABASE)),
    __metadata("design:paramtypes", [Object, Object])
], HealthService);
//# sourceMappingURL=health.service.js.map