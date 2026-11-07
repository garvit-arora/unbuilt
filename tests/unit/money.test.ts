import { describe, expect, it } from "vitest";
import {
  dollarsToCents,
  formatCents,
  formatCentsShort,
  isValidPriceCents,
  parseDollarsToCents,
  PRICE_MAX_CENTS,
  PRICE_MIN_CENTS,
} from "@/lib/money";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [1, "$0.01"],
    [99, "$0.99"],
    [100, "$1.00"],
    [1500, "$15.00"],
    [123456, "$1,234.56"],
    [1_000_000, "$10,000.00"],
  ])("%i cents -> %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("rejects non-integer amounts", () => {
    expect(() => formatCents(15.5)).toThrow(TypeError);
    expect(() => formatCents(Number.NaN)).toThrow(TypeError);
  });

  it("short format drops .00 only for whole dollars", () => {
    expect(formatCentsShort(1500)).toBe("$15");
    expect(formatCentsShort(1550)).toBe("$15.50");
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["15", 1500],
    ["15.5", 1550],
    ["15.05", 1505],
    ["$20", 2000],
    ["1,200.99", 120099],
    [" 0.01 ", 1],
  ])("%s -> %i", (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected);
  });

  it("avoids floating-point rounding", () => {
    // 0.1 + 0.2 style errors: 19.99 * 100 = 1998.9999999999998 in floating point
    expect(parseDollarsToCents("19.99")).toBe(1999);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.", "$"])("rejects %j", (input) => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});

describe("price bounds", () => {
  it("accepts $1..$10,000 in integer cents", () => {
    expect(isValidPriceCents(PRICE_MIN_CENTS)).toBe(true);
    expect(isValidPriceCents(PRICE_MAX_CENTS)).toBe(true);
    expect(isValidPriceCents(99)).toBe(false);
    expect(isValidPriceCents(1_000_001)).toBe(false);
    expect(isValidPriceCents(150.5)).toBe(false);
  });

  it("dollarsToCents only takes whole dollars", () => {
    expect(dollarsToCents(15)).toBe(1500);
    expect(() => dollarsToCents(1.5)).toThrow(TypeError);
  });
});
