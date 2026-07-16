import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';

/** Mandanten-Sichtbarkeit: Dispatcher/Lager/Partner nur freigegebene Mandanten; Admin alle; Kunde über eigene Aufträge. */
export function assertMandantAccess(user: AuthUser, mandantId: string) {
  if (user.role === UserRole.ORG_ADMIN) return;
  if (user.role === UserRole.CUSTOMER_USER) return;
  if (!user.mandantIds.includes(mandantId)) {
    throw new ForbiddenException('Kein Zugriff auf diesen Mandanten');
  }
}

export function mandantFilter(user: AuthUser): { mandantId?: { in: string[] } } | Record<string, never> {
  if (user.role === UserRole.ORG_ADMIN) return {};
  if (user.role === UserRole.CUSTOMER_USER) return {};
  return { mandantId: { in: user.mandantIds.length ? user.mandantIds : ['__none__'] } };
}

export function customerFilter(user: AuthUser): { customerId?: string } | Record<string, never> {
  if (user.role === UserRole.CUSTOMER_USER && user.customerId) {
    return { customerId: user.customerId };
  }
  return {};
}
