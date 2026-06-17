import { Module } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { OrganizationRolesGuard } from '../../common/guards/organization-roles.guard';
import { DatabaseModule } from '../../database/database.module';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OrganizationAuthorizationService } from './organization-authorization.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    AuthService,
    JwtAuthGuard,
    OrganizationAuthorizationService,
    OrganizationRolesGuard,
    PasswordService,
    Reflector,
    TokenService,
  ],
  exports: [
    AuthRepository,
    JwtAuthGuard,
    OrganizationAuthorizationService,
    OrganizationRolesGuard,
    TokenService,
  ],
})
export class AuthModule {}
