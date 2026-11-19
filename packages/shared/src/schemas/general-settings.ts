import { z } from "zod";
import { CURRENCY_EXPONENTS } from "../money";
import { WEEKDAYS } from "./branch";

/**
 * Settings > General Settings — the company-wide regional/display defaults.
 * `defaultLocale`/`timezone`/`defaultCurrency`/`useWesternNumeralsInArabic`/
 * `weekStartsOn` all live on the single `CompanySettings` row.
 * `defaultCurrency` is fixed to AED for this deployment.
 */

export const UpdateGeneralSettingsSchema = z.object({
  defaultLocale: z.enum(["en", "ar"]),
  timezone: z.string().min(1).max(100),
  defaultCurrency: z
    .string()
    .length(3)
    .refine((c) => c in CURRENCY_EXPONENTS, { message: "Unsupported currency" }),
  useWesternNumeralsInArabic: z.boolean(),
  weekStartsOn: z.enum(WEEKDAYS),
});
export type UpdateGeneralSettingsInput = z.infer<typeof UpdateGeneralSettingsSchema>;

export const GeneralSettingsSchema = z.object({
  defaultLocale: z.string(),
  timezone: z.string(),
  defaultCurrency: z.string(),
  useWesternNumeralsInArabic: z.boolean(),
  weekStartsOn: z.enum(WEEKDAYS),
  /** Informational — branches inherit `defaultCurrency` at creation time. */
  branchCount: z.number().int().nonnegative(),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
