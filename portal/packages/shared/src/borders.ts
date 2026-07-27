/** Grenzübergänge Vorarlberg–Schweiz, für den Warenverkehr freigegeben (Straße). */
export const VORARLBERG_CH_GOODS_BORDERS = [
  'Höchst / St. Margrethen',
  'Lustenau / Au',
  'Hohenems / Diepoldsau',
  'Mäder / Kriessern',
  'Koblach / Montlingen',
  'Meiningen / Oberriet',
  'Tisis / Schaanwald',
] as const;

export type VorarlbergChGoodsBorder = (typeof VORARLBERG_CH_GOODS_BORDERS)[number];

/** Preset-Grenze oder Freitext (mind. 2 Zeichen). */
export function isVorarlbergChGoodsBorder(value: string): boolean {
  return (VORARLBERG_CH_GOODS_BORDERS as readonly string[]).includes(value);
}

export function isValidGrenzuebergang(value: string): boolean {
  return String(value || '').trim().length >= 2;
}
