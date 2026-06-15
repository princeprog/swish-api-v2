import { createDatabasePoolConfig } from './database.config';

describe('createDatabasePoolConfig', () => {
  it('builds a pg pool config from database env vars', () => {
    expect(
      createDatabasePoolConfig({
        DB_HOST: 'localhost',
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        DB_NAME: 'swish-db-v2',
      }),
    ).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'postgres',
      password: 'password',
      database: 'swish-db-v2',
    });
  });

  it('throws when a required database env var is missing', () => {
    expect(() =>
      createDatabasePoolConfig({
        DB_PORT: '5432',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        DB_NAME: 'swish-db-v2',
      }),
    ).toThrow('Missing required database env var: DB_HOST');
  });

  it('throws when DB_PORT is not a positive integer', () => {
    expect(() =>
      createDatabasePoolConfig({
        DB_HOST: 'localhost',
        DB_PORT: 'invalid',
        DB_USER: 'postgres',
        DB_PASSWORD: 'password',
        DB_NAME: 'swish-db-v2',
      }),
    ).toThrow('DB_PORT must be a positive integer');
  });
});
