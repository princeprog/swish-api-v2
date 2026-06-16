"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const api_exception_filter_1 = require("./common/filters/api-exception.filter");
const app_config_1 = require("./config/app.config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    const config = app.get(app_config_1.APP_CONFIG);
    app.useGlobalFilters(new api_exception_filter_1.ApiExceptionFilter());
    await app.listen(config.app.port);
}
bootstrap();
//# sourceMappingURL=main.js.map