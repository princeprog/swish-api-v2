import 'dotenv/config';
import { OnModuleDestroy } from '@nestjs/common';
import { type Database } from './database.tokens';
export declare class DatabaseService implements OnModuleDestroy {
    private readonly database;
    constructor();
    get db(): Database;
    onModuleDestroy(): Promise<void>;
}
export declare class DatabaseModule {
}
