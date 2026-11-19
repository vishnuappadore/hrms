/**
 * Money = integer minor units + ISO 4217 currency code, everywhere.
 * The number of decimals is currency-specific (the "exponent"):
 *   OMR/BHD/KWD → 3 (1 OMR = 1000 baisa) · USD/EUR/SAR/AED → 2 · JPY → 0
 *
 * All arithmetic happens on integers — never floats, never numeric strings.
 * DB columns are BIGINT minor units alongside a currency CHAR(3) column.
 * Never mix amounts of different currencies in one calculation.
 */

/** ISO 4217 exponents for currencies we expect to operate in. Extend as we expand. */
export const CURRENCY_EXPONENTS: Record<string, number> = {
  OMR: 3,
  BHD: 3,
  KWD: 3,
  SAR: 2,
  AED: 2,
  QAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  EGP: 2,
  JPY: 0,
};

export type CurrencyCode = string; // ISO 4217; validated against CURRENCY_EXPONENTS at use sites

export function currencyExponent(currency: CurrencyCode): number {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new RangeError(`Unsupported currency: ${currency} — add it to CURRENCY_EXPONENTS`);
  }
  return exponent;
}

export function minorUnitsPerMajor(currency: CurrencyCode): number {
  return 10 ** currencyExponent(currency);
}

/** e.g. toMinorUnits(15.015, "OMR") === 15015 ; toMinorUnits(9.99, "USD") === 999 */
export function toMinorUnits(major: number, currency: CurrencyCode): number {
  const minor = Math.round(major * minorUnitsPerMajor(currency));
  assertMinorUnits(minor);
  return minor;
}

export function fromMinorUnits(minor: number, currency: CurrencyCode): number {
  assertMinorUnits(minor);
  return minor / minorUnitsPerMajor(currency);
}

export function assertMinorUnits(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Invalid money amount: ${value} (must be a safe integer of minor units)`);
  }
}

/**
 * Percentage of an amount, rounded half-up to the nearest minor unit.
 * rate is a percent (e.g. 5 for 5% VAT), supports 2 decimals (e.g. 2.5).
 * Used for tax, percentage discounts, commission — ONE rounding rule everywhere.
 * Currency-independent: operates on minor units directly.
 */
export function percentOf(minorUnits: number, rate: number): number {
  assertMinorUnits(minorUnits);
  // scale rate to integer hundredths to avoid float drift: 2.5% -> 250
  const rateHundredths = Math.round(rate * 100);
  return roundHalfUpDiv(minorUnits * rateHundredths, 10000);
}

/**
 * The effective amount of an employee payroll component. Percentage-of-base components are ALWAYS
 * derived from the CURRENT base salary — the stored per-employee amount is a snapshot that goes stale
 * when base salary changes, so it is never trusted. Fixed-amount components use the stored amount.
 * Shared by payroll generation and the employee profile response so they can never disagree.
 */
export function resolveComponentAmountMinor(
  component: { basis: string; defaultRatePct: number | null },
  baseSalaryMinor: number,
  storedAmountMinor: number,
): number {
  return component.basis === "percentage_of_base"
    ? percentOf(baseSalaryMinor, component.defaultRatePct ?? 0)
    : storedAmountMinor;
}

/** Integer division rounding half away from zero. */
function roundHalfUpDiv(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs + denominator / 2) / denominator);
}

/**
 * Start/end (UTC midnight, inclusive) and day count for a "YYYY-MM" payroll
 * month. Used to prorate a partial month's pay by an employee's Date of Join
 * (docs/MODULES/payroll.md). `end` is the last calendar day of the month.
 */
export interface PayrollMonthBounds {
  start: Date;
  end: Date;
  totalDays: number;
}

export function payrollMonthBounds(payrollMonth: string): PayrollMonthBounds {
  const parts = payrollMonth.split("-").map(Number);
  const year = parts[0]!;
  const month = parts[1]!;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, month - 1, totalDays));
  return { start, end, totalDays };
}

/**
 * How many days of a payroll month an employee is actually paid for, given
 * their Date of Join. Returns `null` if they join AFTER the month ends — not
 * eligible for that month's payroll at all (they weren't employed yet). A
 * `null` joiningDate, or one on/before the month's first day, means the
 * full month is paid — most employees, and employees without a recorded join date.
 */
export function paidDaysForJoin(bounds: PayrollMonthBounds, joiningDate: Date | null): number | null {
  if (!joiningDate) return bounds.totalDays;
  const joinUtc = Date.UTC(joiningDate.getUTCFullYear(), joiningDate.getUTCMonth(), joiningDate.getUTCDate());
  if (joinUtc > bounds.end.getTime()) return null;
  if (joinUtc <= bounds.start.getTime()) return bounds.totalDays;
  return bounds.totalDays - new Date(joinUtc).getUTCDate() + 1;
}

/**
 * Prorates an amount by paidDays/totalDays — e.g. base salary for a
 * mid-month joiner. Same half-up rounding rule as percentOf. Returns the
 * amount unchanged when paidDays === totalDays (avoids rounding drift on the
 * common full-month case).
 */
export function prorateAmount(fullAmountMinor: number, paidDays: number, totalDays: number): number {
  assertMinorUnits(fullAmountMinor);
  if (paidDays === totalDays) return fullAmountMinor;
  return roundHalfUpDiv(fullAmountMinor * paidDays, totalDays);
}

/**
 * One named tax component. Tax systems differ per country:
 *   GCC:            [{ name: "VAT",  ratePercent: 5 }]
 *   India intra-state: [{ name: "CGST", ratePercent: 9 }, { name: "SGST", ratePercent: 9 }]
 *   India inter-state: [{ name: "IGST", ratePercent: 18 }]
 * Which component set applies to a sale (e.g. place-of-supply rules) is
 * business logic in the API; this module only does the arithmetic.
 */
export interface TaxComponent {
  name: string;
  ratePercent: number;
}

export interface TaxLine extends TaxComponent {
  amountMinor: number;
}

/**
 * Each component is computed on the SAME taxable base and rounded
 * independently (parallel components — matches GST invoice practice where
 * CGST and SGST are each rounded on the invoice). Compound ("tax on tax")
 * systems are not supported yet — add an explicit `compoundOn` field if a
 * market ever needs it; do not silently change this to cascading.
 */
export function computeTaxBreakdown(
  taxableMinor: number,
  components: TaxComponent[],
): TaxLine[] {
  assertMinorUnits(taxableMinor);
  return components.map((c) => ({ ...c, amountMinor: percentOf(taxableMinor, c.ratePercent) }));
}

export interface InvoiceTotals {
  subtotalMinor: number;
  discountMinor: number;
  loyaltyRedeemedMinor: number;
  /** per-component breakdown — persist this on the invoice (tax_breakdown) */
  taxBreakdown: TaxLine[];
  /** sum of all components */
  taxMinor: number;
  totalMinor: number;
}

/**
 * Canonical invoice math (currency-independent — all inputs must share one
 * currency). Tax is computed on (subtotal − discounts) at invoice level.
 * Pass `taxComponents` (multi-component systems) or the `taxRatePercent`
 * shorthand (single-rate systems — becomes one "TAX" component).
 * Invariant enforced everywhere (and by tests):
 *   total = subtotal − discount − loyaltyRedeemed + sum(taxBreakdown)
 */
export function computeInvoiceTotals(input: {
  lineTotalsMinor: number[];
  discountMinor?: number;
  loyaltyRedeemedMinor?: number;
  taxRatePercent?: number;
  taxComponents?: TaxComponent[];
}): InvoiceTotals {
  const subtotalMinor = input.lineTotalsMinor.reduce((sum, line) => {
    assertMinorUnits(line);
    return sum + line;
  }, 0);
  const discountMinor = input.discountMinor ?? 0;
  const loyaltyRedeemedMinor = input.loyaltyRedeemedMinor ?? 0;
  assertMinorUnits(discountMinor);
  assertMinorUnits(loyaltyRedeemedMinor);

  const components =
    input.taxComponents ??
    (input.taxRatePercent !== undefined
      ? [{ name: "TAX", ratePercent: input.taxRatePercent }]
      : []);

  const taxableMinor = Math.max(0, subtotalMinor - discountMinor - loyaltyRedeemedMinor);
  const taxBreakdown = computeTaxBreakdown(taxableMinor, components);
  const taxMinor = taxBreakdown.reduce((sum, line) => sum + line.amountMinor, 0);
  return {
    subtotalMinor,
    discountMinor,
    loyaltyRedeemedMinor,
    taxBreakdown,
    taxMinor,
    totalMinor: taxableMinor + taxMinor,
  };
}

/**
 * Display formatting via Intl. Defaults to Western (latn) digits even in
 * Arabic locales — Arabic-Indic digits on invoices cause reconciliation
 * issues — but a company can opt out via `useWesternNumerals` (Settings >
 * General Settings; see `GeneralSettings.useWesternNumeralsInArabic`).
 */
export function formatMoney(
  minorUnits: number,
  currency: CurrencyCode,
  locale = "en",
  useWesternNumerals = true,
): string {
  assertMinorUnits(minorUnits);
  const exponent = currencyExponent(currency);
  const intlLocale = locale.startsWith("ar") && useWesternNumerals ? `${locale}-u-nu-latn` : locale;
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(minorUnits / minorUnitsPerMajor(currency));
}
