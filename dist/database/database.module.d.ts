import 'dotenv/config';
import { OnModuleDestroy } from '@nestjs/common';
import { Kysely } from 'kysely';
import type { DB } from './db';
export declare const DATABASE = "DATABASE";
export type Database = Kysely<DB>;
export declare class DatabaseService implements OnModuleDestroy {
    private readonly database;
    constructor();
    get db(): Database;
    onModuleDestroy(): Promise<void>;
}
export declare class DatabaseModule {
}
