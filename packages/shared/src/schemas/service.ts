import { z } from "zod";
import { PaginationQuerySchema } from "./common";

/* ── Service categories ─────────────────────────────────────────────────── */

export const CreateServiceCategorySchema = z.object({
  nameEn: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateServiceCategoryInput = z.infer<typeof CreateServiceCategorySchema>;

export const UpdateServiceCategorySchema = CreateServiceCategorySchema.partial();
export type UpdateServiceCategoryInput = z.infer<typeof UpdateServiceCategorySchema>;

export const ServiceCategorySchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  sortOrder: z.number().int(),
  /** live services in this category (soft-deleted excluded) */
  serviceCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

/* ── Services ────────────────────────────────────────────────────────────── */

/**
 * Branch rows are EXCEPTIONS: no row → service offered at the branch at the
 * base price. A row can override the price and/or switch availability off.
 * Prices are integer minor units in the tenant's currency (money.ts).
 */
export const BranchServiceOverrideSchema = z.object({
  branchId: z.string().uuid(),
  priceOverrideMinor: z.number().int().min(0).nullable().optional(),
  isAvailable: z.boolean().default(true),
});
export type BranchServiceOverrideInput = z.infer<typeof BranchServiceOverrideSchema>;

export const CreateServiceSchema = z.object({
  categoryId: z.string().uuid(),
  nameEn: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(120),
  /** service time on the calendar */
  durationMinutes: z.number().int().min(5).max(480),
  /** cleanup/turnaround added after the service */
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  priceMinor: z.number().int().min(0),
  status: z.enum(["active", "inactive"]).default("active"),
  branchOverrides: z.array(BranchServiceOverrideSchema).max(200).default([]),
});
export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;

/** branchOverrides, when present, replace the existing set wholesale. */
export const UpdateServiceSchema = CreateServiceSchema.partial();
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

export const ListServicesQuerySchema = PaginationQuerySchema.extend({
  categoryId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  /** only services offered at this branch (exception rows respected) */
  branchId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListServicesQuery = z.infer<typeof ListServicesQuerySchema>;

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  category: z.object({ id: z.string().uuid(), nameEn: z.string(), nameAr: z.string() }),
  nameEn: z.string(),
  nameAr: z.string(),
  durationMinutes: z.number().int(),
  bufferMinutes: z.number().int(),
  priceMinor: z.number().int(),
  status: z.enum(["active", "inactive"]),
  branchOverrides: z.array(
    z.object({
      branchId: z.string().uuid(),
      priceOverrideMinor: z.number().int().nullable(),
      isAvailable: z.boolean(),
    }),
  ),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Service = z.infer<typeof ServiceSchema>;
