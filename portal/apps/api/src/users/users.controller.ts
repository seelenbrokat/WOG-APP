import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { NotificationEvent, UserRole } from '@prisma/client';
import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mandantIds?: string[];
}

class MandantAccessDto {
  @IsArray()
  @IsString({ each: true })
  mandantIds!: string[];
}

class PrefItemDto {
  @IsEnum(NotificationEvent)
  event!: NotificationEvent;

  @IsBoolean()
  email!: boolean;
}

class PrefsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrefItemDto)
  prefs!: PrefItemDto[];
}

@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private service: UsersService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Post('invite')
  @Roles(UserRole.ORG_ADMIN)
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteUserDto) {
    return this.service.invite(user, dto);
  }

  @Patch('me/notification-prefs')
  updatePrefs(@CurrentUser() user: AuthUser, @Body() dto: PrefsDto) {
    return this.service.updatePrefs(user.id, dto.prefs);
  }

  @Patch(':id/mandant-access')
  @Roles(UserRole.ORG_ADMIN)
  setAccess(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MandantAccessDto) {
    return this.service.setMandantAccess(user, id, dto.mandantIds);
  }
}
