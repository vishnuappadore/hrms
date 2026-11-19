import { describe, expect, it } from "vitest";
import {
  computeInvoiceTotals,
  computeTaxBreakdown,
  currencyExponent,
  formatMoney,
  fromMinorUnits,
  paidDaysForJoin,
  payrollMonthBounds,
  percentOf,
  prorateAmount,
  resolveComponentAmountMinor,
  toMinorUnits,
} from "./money";

describe("money (currency-aware minor units)", () => {
  it("respects per-currency exponents", () => {
    expect(toMinorUnits(15.015, "OMR")).toBe(15015); // 3 decimals
    expect(toMinorUnits(9.99, "USD")).toBe(999); // 2 decimals
    expect(toMinorUnits(500, "JPY")).toBe(500); // 0 decimals
    expect(fromMinorUnits(15015, "OMR")).toBe(15.015);
    expect(fromMinorUnits(999, "USD")).toBe(9.99);
    expect(currencyExponent("SAR")).toBe(2);
  });

  it("rejects unknown currencies loudly", () => {
    expect(() => toMinorUnits(1, "XXX")).toThrow(/Unsupported currency/);
  });

  it("rejects unsafe amounts", () => {
    expect(() => fromMinorUnits(0.5, "OMR")).toThrow(RangeError);
    expect(() => fromMinorUnits(Number.MAX_SAFE_INTEGER + 1, "USD")).toThrow(RangeError);
  });

  it("computes percentages with half-up rounding at minor-unit precision", () => {
    expect(percentOf(10000, 5)).toBe(500);
    expect(percentOf(15015, 5)).toBe(751); // 750.75 -> 751
    expect(percentOf(10000, 2.5)).toBe(250);
    expect(percentOf(1, 5)).toBe(0);
    expect(percentOf(10, 5)).toBe(1); // 0.5 -> 1 (half up)
  });

  it("upholds the invoice invariant: total = subtotal - discount - loyalty + tax", () => {
    const totals = computeInvoiceTotals({
      lineTotalsMinor: [5000, 7500, 2515],
      discountMinor: 1000,
      loyaltyRedeemedMinor: 500,
      taxRatePercent: 5,
    });
    expect(totals.subtotalMinor).toBe(15015);
    expect(totals.taxMinor).toBe(676); // 5% of 13515 = 675.75 -> 676
    expect(totals.taxBreakdown).toEqual([{ name: "TAX", ratePercent: 5, amountMinor: 676 }]);
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor - totals.discountMinor - totals.loyaltyRedeemedMinor + totals.taxMinor,
    );
  });

  it("supports multi-component tax (India CGST + SGST), rounded per component", () => {
    // 100.05 INR taxable = 10005 paise; 9% of each = 900.45 -> 900 each
    const totals = computeInvoiceTotals({
      lineTotalsMinor: [10005],
      taxComponents: [
        { name: "CGST", ratePercent: 9 },
        { name: "SGST", ratePercent: 9 },
      ],
    });
    expect(totals.taxBreakdown).toEqual([
      { name: "CGST", ratePercent: 9, amountMinor: 900 },
      { name: "SGST", ratePercent: 9, amountMinor: 900 },
    ]);
    expect(totals.taxMinor).toBe(1800);
    expect(totals.totalMinor).toBe(11805);
    // per-component rounding can differ from single-rate rounding of the sum:
    // 18% of 10005 = 1800.9 -> 1801, but CGST+SGST rounds to 900+900 = 1800.
    const igst = computeInvoiceTotals({
      lineTotalsMinor: [10005],
      taxComponents: [{ name: "IGST", ratePercent: 18 }],
    });
    expect(igst.taxMinor).toBe(1801);
  });

  it("computeTaxBreakdown applies all components to the same base (parallel, not compound)", () => {
    const lines = computeTaxBreakdown(10000, [
      { name: "GST", ratePercent: 5 },
      { name: "PST", ratePercent: 7 },
    ]);
    expect(lines.map((l) => l.amountMinor)).toEqual([500, 700]);
  });

  it("no tax input means zero tax", () => {
    const totals = computeInvoiceTotals({ lineTotalsMinor: [5000] });
    expect(totals.taxMinor).toBe(0);
    expect(totals.taxBreakdown).toEqual([]);
    expect(totals.totalMinor).toBe(5000);
  });

  it("property: invariant holds across many random carts and tax rates", () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const taxRates = [0, 5, 10, 15, 2.5];
    for (let run = 0; run < 500; run++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 6) }, () =>
        Math.floor(rand() * 100000),
      );
      const subtotal = lines.reduce((a, b) => a + b, 0);
      const discount = Math.floor(rand() * subtotal * 0.3);
      const loyalty = Math.floor(rand() * subtotal * 0.2);
      const taxRatePercent = taxRates[run % taxRates.length]!;
      const totals = computeInvoiceTotals({
        lineTotalsMinor: lines,
        discountMinor: discount,
        loyaltyRedeemedMinor: loyalty,
        taxRatePercent,
      });
      expect(totals.totalMinor).toBe(subtotal - discount - loyalty + totals.taxMinor);
      expect(Number.isSafeInteger(totals.totalMinor)).toBe(true);
      expect(totals.totalMinor).toBeGreaterThanOrEqual(0);
    }
  });

  it("payrollMonthBounds computes correct calendar-day counts, including leap Februaries", () => {
    expect(payrollMonthBounds("2026-08").totalDays).toBe(31);
    expect(payrollMonthBounds("2026-02").totalDays).toBe(28); // 2026 is not a leap year
    expect(payrollMonthBounds("2024-02").totalDays).toBe(29); // 2024 is a leap year
    const bounds = payrollMonthBounds("2026-08");
    expect(bounds.start.toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(bounds.end.toISOString().slice(0, 10)).toBe("2026-08-31");
  });

  it("paidDaysForJoin handles the boundary cases of Date of Join proration", () => {
    const bounds = payrollMonthBounds("2026-08"); // 31 days
    expect(paidDaysForJoin(bounds, null)).toBe(31); // no join date recorded -> full month
    expect(paidDaysForJoin(bounds, new Date("2020-01-01"))).toBe(31); // joined long ago -> full month
    expect(paidDaysForJoin(bounds, new Date("2026-08-01"))).toBe(31); // joined on the 1st -> full month
    expect(paidDaysForJoin(bounds, new Date("2026-08-18"))).toBe(14); // joined on the 18th -> 14 days left (18..31 inclusive)
    expect(paidDaysForJoin(bounds, new Date("2026-08-31"))).toBe(1); // joined on the last day -> 1 day
    expect(paidDaysForJoin(bounds, new Date("2026-09-01"))).toBeNull(); // joins next month -> not eligible this month
  });

  it("prorateAmount scales by paidDays/totalDays with half-up rounding, unchanged for a full month", () => {
    expect(prorateAmount(300000, 31, 31)).toBe(300000); // full month, no rounding drift
    expect(prorateAmount(310000, 14, 31)).toBe(140000); // 310000 * 14/31 = 140000 exactly
    expect(prorateAmount(100000, 1, 3)).toBe(33333); // 33333.33 -> 33333
    expect(prorateAmount(100000, 2, 3)).toBe(66667); // 66666.67 -> 66667 (half up)
  });

  it("formats per currency and keeps latn digits in Arabic", () => {
    expect(formatMoney(15015, "OMR", "en")).toMatch(/15\.015/);
    expect(formatMoney(999, "USD", "en")).toMatch(/9\.99/);
    expect(formatMoney(15015, "OMR", "ar")).not.toMatch(/[٠-٩]/);
  });

  it("resolveComponentAmountMinor: percentage derives from current base, fixed uses stored", () => {
    const pct = { basis: "percentage_of_base", defaultRatePct: 12 };
    // stale stored snapshot (12% of an old 200,000 base) is ignored
    expect(resolveComponentAmountMinor(pct, 500000, 24000)).toBe(60000);
    expect(resolveComponentAmountMinor({ basis: "percentage_of_base", defaultRatePct: null }, 500000, 24000)).toBe(0);
    expect(resolveComponentAmountMinor({ basis: "fixed_amount", defaultRatePct: null }, 500000, 5000)).toBe(5000);
  });
});
