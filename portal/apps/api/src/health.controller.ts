import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /** Liveness – immer schnell, ohne DB. */
  @Public()
  @Get()
  health() {
    return { status: 'ok', service: 'wog-portal-api', time: new Date().toISOString() };
  }

  /** Readiness – prüft DB. Für Monitoring/Uptime. */
  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        service: 'wog-portal-api',
        db: 'up',
        time: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        service: 'wog-portal-api',
        db: 'down',
        time: new Date().toISOString(),
      });
    }
  }
}
