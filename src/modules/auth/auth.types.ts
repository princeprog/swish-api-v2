export type AuthUser = {
  email: string;
  id: string;
  name: string;
};

export type AuthSessionResult = {
  accessToken: string;
  refreshCookieMaxAgeMs: number;
  refreshToken: string;
  user: AuthUser;
};

export type RefreshTokenRecord = {
  expires_at: Date;
  id: string;
  revoked_at: Date | null;
  session_id: string;
  user: AuthUser;
  user_id: string;
};

export type AccessTokenPayload = {
  email: string;
  sid: string;
  sub: string;
};

export type RefreshTokenRotationResult =
  | {
      sessionId: string;
      status: 'rotated';
      user: AuthUser;
    }
  | {
      status: 'expired' | 'inactive' | 'not_found' | 'reused';
      sessionId?: string;
    };
