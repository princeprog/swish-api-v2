"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppConfigModule = void 0;
require("dotenv/config");
const common_1 = require("@nestjs/common");
const app_config_1 = require("./app.config");
let AppConfigModule = class AppConfigModule {
};
exports.AppConfigModule = AppConfigModule;
exports.AppConfigModule = AppConfigModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: app_config_1.APP_CONFIG,
                useFactory: () => (0, app_config_1.createAppConfig)(process.env),
            },
        ],
        exports: [app_config_1.APP_CONFIG],
    })
], AppConfigModule);
//# sourceMappingURL=app-config.module.js.map