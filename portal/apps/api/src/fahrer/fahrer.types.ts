import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const DRIVER_AUTH_KEY = 'driverAuth';
export const RequireDriver = () => SetMetadata(DRIVER_AUTH_KEY, true);

export type DriverAuthUser = {
  typ: 'driver';
  id: string;
  organizationId: string;
  tenant: string;
  driverId: string;
  driverTelematicsId: string;
  vehicleId: string;
  vehicleSoloplanId: string;
  firstName?: string | null;
  lastName?: string | null;
  licensePlate?: string | null;
};

export const CurrentDriver = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): DriverAuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
