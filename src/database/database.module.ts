import 'dotenv/config';

import { Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { createDatabasePoolConfig } from './database.config';
import { DATABASE, type Database } from './database.tokens';
import type { DB } from './db';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly database: Database;

  constructor() {
    this.database = new Kysely<DB>({
      dialect: new PostgresDialect({
        pool: new Pool(createDatabasePoolConfig(process.env)),
      }),
    });
  }

  get db(): Database {
    return this.database;
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.destroy();
  }
}

@Module({
  providers: [
    DatabaseService,
    {
      provide: DATABASE,
      useFactory: (databaseService: DatabaseService): Database =>
        databaseService.db,
      inject: [DatabaseService],
    },
  ],
  exports: [DATABASE, DatabaseService],
})
export class DatabaseModule {}
