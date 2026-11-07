/**
 * Money is always integer minor units (USD cents) plus a currency code (design 5.1).
 * This module is the only place that formats money for display.
 */

export const PRICE_MIN_CENTS = 100;
export const PRICE_MAX_CENTS = 1_000_000;
export const DEFAULT_CURRENCY = "USD";

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string, wholeUnits: boolean): Intl.NumberFormat {
  const key = `${currency}:${wholeUnits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(wholeUnits ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new TypeError(`Money amounts must be integer cents, got ${cents}`);
}

/** `formatCents(1500)` → "$15.00". */
export function formatCents(cents: number, currency: string = DEFAULT_CURRENCY): string {
  assertCents(cents);
  return formatterFor(currency, false).format(cents / 100);
}

/** Compact display for whole-dollar amounts: `formatCentsShort(1500)` → "$15", `formatCentsShort(1550)` → "$15.50". */
export function formatCentsShort(cents: number, currency: string = DEFAULT_CURRENCY): string {
  assertCents(cents);
  return formatterFor(currency, cents % 100 === 0).format(cents / 100);
}

/**
 * Parses a user-entered dollar amount ("15", "15.5", "$1,200.99") into integer cents without floating-point
 * rounding. Returns null for anything that is not a non-negative amount with at most two decimals.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Whole dollars to cents, for sliders and fixtures. */
export function dollarsToCents(dollars: number): number {
  if (!Number.isSafeInteger(dollars)) throw new TypeError(`Expected whole dollars, got ${dollars}`);
  return dollars * 100;
}

/** Bounds for every user-entered price: $1 to $10,000. */
export function isValidPriceCents(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= PRICE_MIN_CENTS && cents <= PRICE_MAX_CENTS;
}
