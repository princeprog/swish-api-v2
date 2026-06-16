import type { Kysely } from 'kysely';
import type { DB } from './db';
export declare const DATABASE = "DATABASE";
export type Database = Kysely<DB>;
