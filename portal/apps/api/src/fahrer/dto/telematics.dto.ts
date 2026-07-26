import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class LocationDto {
  @IsNumber()
  latitude!: number;

  @IsNumber()
  longitude!: number;

  @IsOptional()
  @IsString()
  information?: string;
}

export class TourStatusDto {
  @IsString()
  tourNumber!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  statusText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}

export class TourStopStatusDto {
  @IsString()
  tourNumber!: string;

  @IsString()
  tourStopId!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  statusText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadingUnitExchangeDto)
  loadingUnitExchanges?: LoadingUnitExchangeDto[];
}

export class LoadingUnitExchangeDto {
  @IsString()
  matchcode!: string;

  @IsNumber()
  given!: number;

  @IsNumber()
  taken!: number;
}

export class TransportOrderStatusDto {
  @IsString()
  transportOrderNumber!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  statusText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocationDto)
  location?: LocationDto;
}

export class DocumentDto {
  @IsString()
  fileName!: string;

  @IsString()
  contentBase64!: string;

  @IsOptional()
  @IsString()
  tourNumber?: string;

  @IsOptional()
  @IsString()
  transportOrderNumber?: string;

  @IsOptional()
  @IsString()
  tourStopId?: string;

  @IsOptional()
  @IsString()
  fileSignature?: string;
}

export class SsccItemDto {
  @IsString()
  code!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  scanPoint?: string;
}

export class SsccStatusDto {
  @IsString()
  transportOrderNumber!: string;

  @IsOptional()
  @IsString()
  tourNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SsccItemDto)
  ssccs!: SsccItemDto[];
}

export class VehicleLocationDto {
  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @IsOptional()
  @IsString()
  tourNumber?: string;
}
