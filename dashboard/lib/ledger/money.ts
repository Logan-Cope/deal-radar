export const MAX_CENTS = 100_000_000;

/** `$1,150` for whole dollars, `$339.43` otherwise. */
export function formatMoney(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** `425.00` from 42500: the reader's money format. */
export const moneyValue = (cents: number): string => (cents / 100).toFixed(2);

/** Cents from `425`, `425.00`, `$1,150.5`; null for anything else. */
export function parseMoney(text: string): number | null {
  const clean = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}
