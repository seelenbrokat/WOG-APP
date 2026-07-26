import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DriverAuthUser } from './fahrer.types';

@Injectable()
export class FahrerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as DriverAuthUser | undefined;
    if (!user || user.typ !== 'driver') {
      throw new UnauthorizedException('Fahrer-Anmeldung erforderlich');
    }
    return true;
  }
}
