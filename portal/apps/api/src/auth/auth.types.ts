import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  organizationId: string;
  customerId?: string | null;
  partnerId?: string | null;
  mandantIds: string[];
  mustChangePassword?: boolean;
  /** true, wenn ORG_ADMIN die Kundenansicht eines anderen Kunden nutzt */
  impersonating?: boolean;
  /** echte DB-Rolle (ORG_ADMIN), während role ggf. CUSTOMER_USER ist */
  realRole?: UserRole;
  impersonatingCustomerName?: string | null;
};

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
