import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
  ChangePasswordDto,
  CreateLoginQrDto,
  QrPortalLoginDto,
  ImpersonateCustomerDto,
} from './dto/auth.dto';
import { Public } from './public.decorator';
import { CurrentUser, AuthUser, Roles } from './auth.types';
import { RolesGuard } from './roles.guard';

@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('qr-login')
  qrLogin(@Body() dto: QrPortalLoginDto) {
    return this.auth.loginWithQr(dto.token);
  }

  @Public()
  @Post('verify-email')
  verify(@Body() dto: VerifyEmailDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  forgot(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Kundenliste für Ansichts-Umschalter (ORG_ADMIN, auch während Impersonation). */
  @Get('impersonate/customers')
  listImpersonationCustomers(@CurrentUser() user: AuthUser) {
    return this.auth.listImpersonationCustomers(user);
  }

  @Post('impersonate')
  startImpersonation(@CurrentUser() user: AuthUser, @Body() dto: ImpersonateCustomerDto) {
    return this.auth.startImpersonation(user, dto.customerId);
  }

  @Post('impersonate/stop')
  stopImpersonation(@CurrentUser() user: AuthUser) {
    return this.auth.stopImpersonation(user);
  }

  @Get('login-qr/staff')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  listStaffForQr(@CurrentUser() user: AuthUser) {
    return this.auth.listStaffForQr(user);
  }

  @Post('login-qr')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createLoginQr(@CurrentUser() user: AuthUser, @Body() dto: CreateLoginQrDto) {
    return this.auth.createLoginQr(user, dto);
  }
}
