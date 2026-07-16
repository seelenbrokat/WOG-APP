/** Grenzübergänge Vorarlberg–Schweiz, für den Warenverkehr freigegeben (Straße). */
export const VORARLBERG_CH_GOODS_BORDERS = [
  'Höchst / St. Margrethen',
  'Lustenau / Au',
  'Hohenems / Diepoldsau',
  'Mäder / Kriessern',
  'Gaißau / Rheineck',
  'Koblach / Montlingen',
  'Meiningen / Oberriet',
  'Feldkirch-Bangs / Rüthi',
  'Lustenau-Schmitterbrücke / Diepoldsau',
  'Lustenau-Wiesenrain / Widnau (max. 16 t)',
] as const;

export type VorarlbergChGoodsBorder = (typeof VORARLBERG_CH_GOODS_BORDERS)[number];

export function isVorarlbergChGoodsBorder(value: string): boolean {
  return (VORARLBERG_CH_GOODS_BORDERS as readonly string[]).includes(value);
}
