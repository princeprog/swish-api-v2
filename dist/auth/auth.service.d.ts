import { AuthRepository } from './auth.repository';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import type { AuthSessionResult, AuthUser } from './auth.types';
export declare class AuthService {
    private readonly authRepository;
    private readonly passwordService;
    private readonly tokenService;
    constructor(authRepository: AuthRepository, passwordService: PasswordService, tokenService: TokenService);
    getMe(user: AuthUser): {
        user: AuthUser;
    };
    login(input: LoginDto): Promise<AuthSessionResult>;
    logout(refreshToken?: string): Promise<void>;
    refresh(refreshToken?: string): Promise<AuthSessionResult>;
    register(input: RegisterDto): Promise<AuthSessionResult>;
    private createSessionResult;
}
