import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  type ArgumentsHost,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

function createHost(url = '/test') {
  const response = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
  const request = { url };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

describe('ApiExceptionFilter', () => {
  it('formats Nest HTTP exceptions with a consistent response body', () => {
    const { host, response } = createHost('/organizations');

    new ApiExceptionFilter().catch(
      new BadRequestException(['name is required']),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'BAD_REQUEST',
          message: ['name is required'],
          path: '/organizations',
          statusCode: HttpStatus.BAD_REQUEST,
          timestamp: expect.any(String),
        },
      }),
    );
  });

  it('hides unexpected exception details behind an internal error response', () => {
    const { host, response } = createHost('/health/ready');

    new ApiExceptionFilter().catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Internal server error',
          path: '/health/ready',
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          timestamp: expect.any(String),
        },
      }),
    );
  });

  it('uses the exception response message when available', () => {
    const { host, response } = createHost('/auth/login');

    new ApiExceptionFilter().catch(
      new InternalServerErrorException('Something failed'),
      host,
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: 'Something failed',
        }),
      }),
    );
  });
});
