"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiExceptionFilter = void 0;
const common_1 = require("@nestjs/common");
function isExceptionResponse(value) {
    return typeof value === 'object' && value !== null;
}
function getHttpStatusName(status) {
    return common_1.HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR';
}
function getHttpMessage(exception) {
    const exceptionResponse = exception.getResponse();
    if (typeof exceptionResponse === 'string') {
        return exceptionResponse;
    }
    if (isExceptionResponse(exceptionResponse) && exceptionResponse.message) {
        return exceptionResponse.message;
    }
    return exception.message;
}
let ApiExceptionFilter = class ApiExceptionFilter {
    catch(exception, host) {
        const context = host.switchToHttp();
        const response = context.getResponse();
        const request = context.getRequest();
        const isHttpException = exception instanceof common_1.HttpException;
        const statusCode = isHttpException
            ? exception.getStatus()
            : common_1.HttpStatus.INTERNAL_SERVER_ERROR;
        const message = isHttpException
            ? getHttpMessage(exception)
            : 'Internal server error';
        response.status(statusCode).json({
            error: {
                code: getHttpStatusName(statusCode),
                message,
                path: request.url,
                statusCode,
                timestamp: new Date().toISOString(),
            },
        });
    }
};
exports.ApiExceptionFilter = ApiExceptionFilter;
exports.ApiExceptionFilter = ApiExceptionFilter = __decorate([
    (0, common_1.Catch)()
], ApiExceptionFilter);
//# sourceMappingURL=api-exception.filter.js.map