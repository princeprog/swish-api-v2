import type { Request } from 'express';
import type { AuthUser } from './auth.types';
export type CookieRequest = Omit<Request, 'cookies'> & {
    cookies?: Record<string, string | undefined>;
};
export type AuthenticatedRequest = CookieRequest & {
    user: AuthUser;
};
