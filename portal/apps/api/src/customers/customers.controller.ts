import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsOptional, IsString } from 'class-validator';

class CreateCustomerDto {
  @IsString()
  customerNumber!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  vatId?: string;
}

class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  vatId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class AddressDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsString()
  street!: string;

  @IsString()
  zip!: string;

  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

class ContactDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

@Controller('customers')
@UseGuards(RolesGuard)
export class CustomersController {
  constructor(private service: CustomersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user, id);
  }

  @Post()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.service.update(user, id, dto);
  }

  @Post(':id/addresses')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  addAddress(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddressDto) {
    return this.service.addAddress(user, id, dto);
  }

  @Post(':id/contacts')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  addContact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ContactDto) {
    return this.service.addContact(user, id, dto);
  }
}
