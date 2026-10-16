import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const appUrl = process.env.APP_URL?.trim();
  const isProd = process.env.NODE_ENV === 'production' || !!appUrl;
  if (isProd && !process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET muss in Produktion gesetzt sein');
    process.exit(1);
  }

  // CORS: nur konfigurierte Portal-Origin(s), kein Reflect-All
  const corsOrigins = (process.env.CORS_ORIGINS || appUrl || 'http://localhost:3000')
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  // Grundlegende Security-Header (ohne Extra-Dependency)
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Hinter Nginx: echte Client-IP für Rate-Limits
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance?.();
  if (instance?.set) {
    instance.set('trust proxy', 1);
  }

  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port);
  console.log(`WOG API listening on :${port}`);
}

bootstrap();
