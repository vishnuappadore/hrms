import { z } from "zod";

export const TaxComponentSchema = z.object({
  name: z.string().min(1).max(50), // "VAT", "CGST", "SGST", "IGST", "PST"
  ratePercent: z.number().min(0).max(100),
});

export const CreateTaxProfileSchema = z.object({
  name: z.string().min(1).max(100),
  /** ISO 3166-1 alpha-2, used by per-country selection rules later */
  country: z.string().length(2).nullable().optional(),
  isDefault: z.boolean().default(false),
  components: z.array(TaxComponentSchema).min(1).max(10),
});
export type CreateTaxProfileInput = z.infer<typeof CreateTaxProfileSchema>;

export const UpdateTaxProfileSchema = CreateTaxProfileSchema.partial();
export type UpdateTaxProfileInput = z.infer<typeof UpdateTaxProfileSchema>;

export const TaxProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  country: z.string().nullable(),
  isDefault: z.boolean(),
  components: z.array(
    TaxComponentSchema.extend({ id: z.string().uuid(), sortOrder: z.number() }),
  ),
});
export type TaxProfile = z.infer<typeof TaxProfileSchema>;
