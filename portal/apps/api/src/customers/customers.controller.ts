import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CurrentUser, AuthUser, Roles } from '../auth/auth.types';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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

  @IsOptional()
  @IsBoolean()
  documentsModuleEnabled?: boolean;
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
  @IsString()
  usage?: string;

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

class TemplateDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  mandantId?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  transportMode?: string;

  @IsOptional()
  @IsString()
  goodsDescription?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  packageCount?: number;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  volumeM3?: number;

  @IsOptional()
  @IsString()
  pickupAddressId?: string;

  @IsOptional()
  @IsString()
  deliveryAddressId?: string;

  @IsOptional()
  @IsString()
  pickupCompany?: string;

  @IsOptional()
  @IsString()
  pickupStreet?: string;

  @IsOptional()
  @IsString()
  pickupZip?: string;

  @IsOptional()
  @IsString()
  pickupCity?: string;

  @IsOptional()
  @IsString()
  pickupCountry?: string;

  @IsOptional()
  @IsString()
  deliveryCompany?: string;

  @IsOptional()
  @IsString()
  deliveryStreet?: string;

  @IsOptional()
  @IsString()
  deliveryZip?: string;

  @IsOptional()
  @IsString()
  deliveryCity?: string;

  @IsOptional()
  @IsString()
  deliveryCountry?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  scheduleEnabled?: boolean;

  @IsOptional()
  @IsIn(['DAILY', 'WEEKLY'])
  scheduleFreq?: string;

  @IsOptional()
  @IsString()
  scheduleWeekdays?: string;
}

@Controller('customers')
@UseGuards(RolesGuard)
export class CustomersController {
  constructor(private service: CustomersService) {}

  @Get()
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user);
  }

  @Get('me/addresses')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  myAddresses(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.service.listAddresses(user, customerId || user.customerId || undefined);
  }

  @Get('me/templates')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  myTemplates(@CurrentUser() user: AuthUser, @Query('customerId') customerId?: string) {
    return this.service.listTemplates(user, customerId || user.customerId || undefined);
  }

  @Post('me/addresses')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createMyAddress(
    @CurrentUser() user: AuthUser,
    @Body() dto: AddressDto,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.addAddress(user, customerId || user.customerId || undefined, dto);
  }

  @Post('me/addresses/import-from-shipments')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  importAddressesFromShipments(
    @CurrentUser() user: AuthUser,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.importAddressesFromShipments(
      user,
      customerId || user.customerId || undefined,
    );
  }

  @Post('me/templates')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  createMyTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: TemplateDto,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.createTemplate(user, dto.customerId || customerId || user.customerId || undefined, dto);
  }

  @Patch('addresses/:addressId')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('addressId') addressId: string,
    @Body() dto: Partial<AddressDto>,
  ) {
    return this.service.updateAddress(user, addressId, dto as any);
  }

  @Delete('addresses/:addressId')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  deleteAddress(@CurrentUser() user: AuthUser, @Param('addressId') addressId: string) {
    return this.service.deleteAddress(user, addressId);
  }

  @Patch('templates/:templateId')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  updateTemplate(
    @CurrentUser() user: AuthUser,
    @Param('templateId') templateId: string,
    @Body() dto: TemplateDto,
  ) {
    return this.service.updateTemplate(user, templateId, dto);
  }

  @Delete('templates/:templateId')
  @Roles(UserRole.CUSTOMER_USER, UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER)
  deleteTemplate(@CurrentUser() user: AuthUser, @Param('templateId') templateId: string) {
    return this.service.deleteTemplate(user, templateId);
  }

  @Get(':id')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
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

  @Get(':id/addresses')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listAddresses(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listAddresses(user, id);
  }

  @Get(':id/templates')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  listTemplates(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listTemplates(user, id);
  }

  @Post(':id/templates')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  createTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: TemplateDto) {
    return this.service.createTemplate(user, id, dto);
  }

  @Post(':id/contacts')
  @Roles(UserRole.ORG_ADMIN, UserRole.MANDANT_DISPATCHER, UserRole.CUSTOMER_USER)
  addContact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ContactDto) {
    return this.service.addContact(user, id, dto);
  }
}
