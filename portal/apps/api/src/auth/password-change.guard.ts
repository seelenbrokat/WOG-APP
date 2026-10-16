import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { AuthUser } from './auth.types';

/**
 * Blockiert API-Zugriff, solange mustChangePassword=true.
 * Erlaubt nur /auth/me und /auth/change-password.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{
      user?: AuthUser;
      url?: string;
      originalUrl?: string;
      path?: string;
    }>();
    const user = req.user;
    if (!user?.mustChangePassword) return true;

    const raw = String(req.originalUrl || req.url || req.path || '');
    const path = raw.split('?')[0].replace(/\/+$/, '');
    const allowed =
      path.endsWith('/auth/me') ||
      path.endsWith('/auth/change-password') ||
      path === '/auth/me' ||
      path === '/auth/change-password';

    if (allowed) return true;
    throw new ForbiddenException(
      'Passwortänderung erforderlich. Bitte zuerst das Passwort ändern.',
    );
  }
}
