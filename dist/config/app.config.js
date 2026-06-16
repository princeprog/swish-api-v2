"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_CONFIG = void 0;
exports.createAppConfig = createAppConfig;
const database_config_1 = require("../database/database.config");
exports.APP_CONFIG = 'APP_CONFIG';
function requireAppEnv(env, key) {
    const value = env[key];
    if (!value) {
        throw new Error(`Missing required app env var: ${key}`);
    }
    return value;
}
function parsePort(value) {
    if (!value) {
        return 3000;
    }
    const port = Number(value);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error('PORT must be a positive integer');
    }
    return port;
}
function parseBoolean(value, fallback) {
    if (!value) {
        return fallback;
    }
    return value.toLowerCase() === 'true';
}
function parseEnvironment(value) {
    if (value === 'production' || value === 'test') {
        return value;
    }
    return 'development';
}
function parseJwtDuration(value) {
    const duration = value ?? '15m';
    if (!/^\d+[smhd]$/.test(duration)) {
        throw new Error('JWT_ACCESS_EXPIRES_IN must use a duration like 15m or 1h');
    }
    return duration;
}
function createAppConfig(env) {
    const environment = parseEnvironment(env.NODE_ENV);
    const accessTokenSecret = requireAppEnv(env, 'JWT_ACCESS_SECRET');
    const refreshTokenSecret = requireAppEnv(env, 'JWT_REFRESH_SECRET');
    return {
        app: {
            environment,
            port: parsePort(env.PORT),
            serviceName: env.SERVICE_NAME ?? 'swish-api-v2',
        },
        auth: {
            accessTokenExpiresIn: parseJwtDuration(env.JWT_ACCESS_EXPIRES_IN),
            accessTokenSecret,
            refreshCookieName: env.AUTH_REFRESH_COOKIE_NAME ?? 'swish_refresh_token',
            refreshTokenExpiresIn: env.JWT_REFRESH_EXPIRES_IN ?? '30d',
            refreshTokenSecret,
            secureCookies: parseBoolean(env.AUTH_COOKIE_SECURE, environment === 'production'),
        },
        database: (0, database_config_1.createDatabasePoolConfig)(env),
    };
}
//# sourceMappingURL=app.config.js.map