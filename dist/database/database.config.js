"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDatabasePoolConfig = createDatabasePoolConfig;
function requireEnv(env, key) {
    const value = env[key];
    if (!value) {
        throw new Error(`Missing required database env var: ${key}`);
    }
    return value;
}
function createDatabasePoolConfig(env) {
    const port = Number(requireEnv(env, 'DB_PORT'));
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error('DB_PORT must be a positive integer');
    }
    return {
        host: requireEnv(env, 'DB_HOST'),
        port,
        user: requireEnv(env, 'DB_USER'),
        password: requireEnv(env, 'DB_PASSWORD'),
        database: requireEnv(env, 'DB_NAME'),
    };
}
//# sourceMappingURL=database.config.js.map