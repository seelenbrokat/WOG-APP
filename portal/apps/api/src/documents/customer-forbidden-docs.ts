/**
 * Dokumente, die Kunden niemals sehen/herunterladen dürfen.
 * CH-Bordereau enthält Abgaben über mehrere Sendungen/Kunden – streng intern.
 */
export function isForbiddenForCustomerDocument(doc: {
  fileName?: string | null;
  sourceFileName?: string | null;
  source?: string | null;
  type?: string | null;
  categoryCode?: string | null;
}): boolean {
  const fileName = String(doc.fileName || '');
  const sourceFile = String(doc.sourceFileName || '');
  const hay = `${fileName}\n${sourceFile}`.toLowerCase();

  // Explizit: Bordereau (UI-Name „CH Bordereau …“ oder Mercurio edece_bordereau_…)
  if (hay.includes('bordereau')) return true;

  // Mercurio-Zolldokumente ohne Kunden-Kategorie (Austritt = CUSTOMS_EXIT) sind intern
  if (
    String(doc.source || '').toUpperCase() === 'MERCURIO' &&
    !doc.categoryCode
  ) {
    return true;
  }

  // Unkategorisierte Zollpapiere an der Sendung (kein Dokumentenmodul-Austritt)
  if (doc.type === 'CUSTOMS_PAPER' && !doc.categoryCode) {
    return true;
  }

  return false;
}
