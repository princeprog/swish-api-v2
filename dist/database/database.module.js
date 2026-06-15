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
exports.DatabaseModule = exports.DatabaseService = exports.DATABASE = void 0;
require("dotenv/config");
const common_1 = require("@nestjs/common");
const kysely_1 = require("kysely");
const pg_1 = require("pg");
const database_config_1 = require("./database.config");
exports.DATABASE = 'DATABASE';
let DatabaseService = class DatabaseService {
    database;
    constructor() {
        this.database = new kysely_1.Kysely({
            dialect: new kysely_1.PostgresDialect({
                pool: new pg_1.Pool((0, database_config_1.createDatabasePoolConfig)(process.env)),
            }),
        });
    }
    get db() {
        return this.database;
    }
    async onModuleDestroy() {
        await this.database.destroy();
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], DatabaseService);
let DatabaseModule = class DatabaseModule {
};
exports.DatabaseModule = DatabaseModule;
exports.DatabaseModule = DatabaseModule = __decorate([
    (0, common_1.Module)({
        providers: [
            DatabaseService,
            {
                provide: exports.DATABASE,
                useFactory: (databaseService) => databaseService.db,
                inject: [DatabaseService],
            },
        ],
        exports: [exports.DATABASE, DatabaseService],
    })
], DatabaseModule);
//# sourceMappingURL=database.module.js.map