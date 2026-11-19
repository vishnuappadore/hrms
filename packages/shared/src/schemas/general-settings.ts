import { z } from "zod";
import { CURRENCY_EXPONENTS } from "../money";
import { WEEKDAYS } from "./branch";

/**
 * Settings > General Settings (docs/MODULES/settings.md section 1) — the
 * tenant-wide regional/display defaults previously shown read-only on
 * Company Info. `defaultLocale`/`timezone`/`defaultCurrency` live on `Tenant`
 * already; `useWesternNumeralsInArabic`/`weekStartsOn` are new columns.
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
  /** The web form uses this to lock `defaultCurrency` — changing it once any
   *  branch exists risks the mixed-currency state docs/GLOBALIZATION.md says
   *  to avoid (branches inherit `defaultCurrency` at creation time). */
  branchCount: z.number().int().nonnegative(),
});
export type GeneralSettings = z.infer<typeof GeneralSettingsSchema>;
