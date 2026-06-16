"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const api_exception_filter_1 = require("./common/filters/api-exception.filter");
const app_config_1 = require("./config/app.config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const config = app.get(app_config_1.APP_CONFIG);
    app.use((0, cookie_parser_1.default)());
    app.useGlobalFilters(new api_exception_filter_1.ApiExceptionFilter());
    app.useGlobalPipes(new common_1.ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
    }));
    await app.listen(config.app.port);
}
void bootstrap();
//# sourceMappingURL=main.js.map