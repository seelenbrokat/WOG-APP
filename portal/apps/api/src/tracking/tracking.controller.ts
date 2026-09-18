import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TrackingService } from './tracking.service';
import { Public } from '../auth/public.decorator';
import { IsOptional, IsString } from 'class-validator';

class TrackQuery {
  @IsString()
  tn!: string;

  @IsOptional()
  @IsString()
  pin?: string;
}

@Controller('tracking')
export class TrackingController {
  constructor(private service: TrackingService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get()
  track(@Query() query: TrackQuery) {
    return this.service.track(query.tn, query.pin);
  }
}
