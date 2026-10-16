import { IsOptional, IsString, MinLength } from 'class-validator';

export class PinLoginDto {
  @IsString()
  vehicleId!: string;

  @IsString()
  @MinLength(1)
  pin!: string;

  @IsOptional()
  @IsString()
  driverTelematicsId?: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;

  @IsOptional()
  @IsString()
  tenant?: string;
}

export class QrLoginDto {
  @IsString()
  @MinLength(16)
  token!: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(16)
  refreshToken!: string;
}
