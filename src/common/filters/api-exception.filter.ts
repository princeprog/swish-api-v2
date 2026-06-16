import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

type ExceptionResponse = {
  error?: string;
  message?: string | string[];
  statusCode?: number;
};

function isExceptionResponse(value: unknown): value is ExceptionResponse {
  return typeof value === 'object' && value !== null;
}

function getHttpStatusName(status: number): string {
  return HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR';
}

function getHttpMessage(exception: HttpException): string | string[] {
  const exceptionResponse = exception.getResponse();

  if (typeof exceptionResponse === 'string') {
    return exceptionResponse;
  }

  if (isExceptionResponse(exceptionResponse) && exceptionResponse.message) {
    return exceptionResponse.message;
  }

  return exception.message;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
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
}
