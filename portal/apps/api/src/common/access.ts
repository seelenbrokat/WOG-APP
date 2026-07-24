import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';

/** Mandanten-Sichtbarkeit: Dispatcher/Partner nur freigegebene Mandanten; Admin alle; Kunde über eigene Aufträge. */
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
  return { mandantId: { in: user.mandantIds } };
}

/**
 * Kunden-Isolation: CUSTOMER_USER sieht ausschließlich eigene Daten.
 * Ohne verknüpftes customerId → kein Zugriff (fail-closed).
 */
export function customerFilter(user: AuthUser): { customerId: string } | Record<string, never> {
  if (user.role === UserRole.CUSTOMER_USER) {
    if (!user.customerId) {
      throw new ForbiddenException('Kein Kundenkonto verknüpft');
    }
    return { customerId: user.customerId };
  }
  return {};
}

/** Explizit: Kunde darf nur auf die eigene customerId zugreifen. */
export function assertCustomerAccess(user: AuthUser, customerId: string | null | undefined) {
  if (user.role !== UserRole.CUSTOMER_USER) return;
  if (!user.customerId) throw new ForbiddenException('Kein Kundenkonto verknüpft');
  if (!customerId || customerId !== user.customerId) {
    throw new ForbiddenException('Kein Zugriff auf diese Kundendaten');
  }
}
