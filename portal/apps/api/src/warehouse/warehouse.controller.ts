import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';
import { WarehouseService } from './warehouse.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';

class NoteDto {
  @IsString()
  @MinLength(1)
  body!: string;
}

const STAFF = [UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.WAREHOUSE_STAFF] as const;

@Controller('warehouse')
@UseGuards(RolesGuard)
export class WarehouseController {
  constructor(private service: WarehouseService) {}

  @Get('tours')
  @Roles(...STAFF)
  listTours(@CurrentUser() user: AuthUser) {
    return this.service.listTours(user);
  }

  @Get('tours/:id')
  @Roles(...STAFF)
  getTour(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getTour(user, id);
  }

  @Post('tours/:tourId/shipments/:shipmentId/notes')
  @Roles(...STAFF)
  addNote(
    @CurrentUser() user: AuthUser,
    @Param('tourId') tourId: string,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: NoteDto,
  ) {
    return this.service.addNote(user, tourId, shipmentId, dto.body);
  }

  @Post('tours/:tourId/shipments/:shipmentId/photos')
  @Roles(...STAFF)
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  addPhoto(
    @CurrentUser() user: AuthUser,
    @Param('tourId') tourId: string,
    @Param('shipmentId') shipmentId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Datei fehlt');
    return this.service.addPhoto(user, tourId, shipmentId, file);
  }
}
