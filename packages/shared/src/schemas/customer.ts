import { z } from "zod";
import { MobileSchema, PaginationQuerySchema } from "./common";

/**
 * Customers — the master identity record. Created here or by Appointments /
 * Walk-in Queue / POS; one unified profile per person, keyed by mobile.
 * Tier ladder mirrors CUSTOMER_TIERS in ../enums (default "new"), directly
 * editable. Visits / points / totalSpend are system-maintained counters
 * (POS / Appointments / Loyalty increment them) — never set from the client.
 */

const TierEnum = z.enum(["new", "bronze", "silver", "gold", "platinum"]);

export const CreateCustomerSchema = z.object({
  mobile: MobileSchema,
  name: z.string().trim().min(2, "nameTooShort").max(200),
  /** Stored normalized (trimmed, lower-case) — the DB unique index relies on it being case-folded. */
  email: z.string().trim().toLowerCase().email().nullable().optional(),
  tier: TierEnum.default("new"),
  /** Set via the photo-upload-url flow (mirrors Company Info's logoKey), not typed directly. */
  photoKey: z.string().nullable().optional(),
});
export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;

/** Mirrors PresignLeaveAttachmentSchema/PresignedUploadSchema (./leave.ts) — same upload flow. */
export const PresignCustomerPhotoSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
});
export type PresignCustomerPhotoInput = z.infer<typeof PresignCustomerPhotoSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

export const ListCustomersQuerySchema = PaginationQuerySchema.extend({
  tier: TierEnum.optional(),
  /** matches Customer Name + Mobile Number */
  search: z.string().max(100).optional(),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

export const CustomerSchema = z.object({
  id: z.string().uuid(),
  mobile: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  tier: TierEnum,
  /** completed salon visits — system-maintained counter (default 0) */
  visits: z.number().int(),
  /** current loyalty point balance — system-maintained (default 0) */
  points: z.number().int(),
  /** lifetime spend, integer minor units of `currency` — system-maintained (default 0) */
  totalSpendMinor: z.number().int(),
  /** ISO 4217, the tenant's default currency (for rendering totalSpendMinor) */
  currency: z.string(),
  /** Presigned GET URL for the current profile photo, regenerated on each read. */
  photoUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Customer = z.infer<typeof CustomerSchema>;
