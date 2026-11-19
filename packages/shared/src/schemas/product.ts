import { z } from "zod";
import { PaginationQuerySchema } from "./common";

/**
 * Retail products — the catalogue master, shared across branches; stock is held
 * per branch (StockLevel). Prices are integer minor units of the tenant currency
 * (money.ts). The full Inventory module (categories, transfers, procurement) is
 * Phase 7; this is the minimal slice POS needs to sell + deduct stock.
 */

const UNITS = ["pcs", "box", "bottle", "pack", "tube", "set"] as const;

export const CreateProductSchema = z
  .object({
    nameEn: z.string().min(1).max(160),
    nameAr: z.string().max(160).nullable().optional(),
    sku: z.string().min(1).max(64),
    brand: z.string().max(120).nullable().optional(),
    /** sale price, integer minor units */
    salePriceMinor: z.number().int().min(0),
    /** cost price, integer minor units; must be ≤ sale price (business rule) */
    costPriceMinor: z.number().int().min(0).default(0),
    reorderLevel: z.number().int().min(0).max(100000).default(0),
    unit: z.enum(UNITS).default("pcs"),
    status: z.enum(["active", "inactive"]).default("active"),
    /** optional opening stock, keyed by branchId → quantity */
    openingStock: z
      .array(z.object({ branchId: z.string().uuid(), quantity: z.number().int().min(0) }))
      .max(200)
      .optional(),
  })
  .refine((v) => v.costPriceMinor <= v.salePriceMinor, {
    message: "Cost price must not exceed sale price",
    path: ["costPriceMinor"],
  });
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const UpdateProductSchema = CreateProductSchema.innerType().partial();
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;

export const ListProductsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["active", "inactive"]).optional(),
  /** include per-branch stock for this branch in the response */
  branchId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

/** Manual stock adjustment (set or delta) — Phase 7 expands this into transfers/GRN. */
export const AdjustStockSchema = z.object({
  branchId: z.string().uuid(),
  /** signed change applied to the branch quantity; result may not go negative */
  delta: z.number().int(),
  reason: z.string().max(200).nullable().optional(),
});
export type AdjustStockInput = z.infer<typeof AdjustStockSchema>;

export const ProductSchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  sku: z.string(),
  brand: z.string().nullable(),
  salePriceMinor: z.number().int(),
  costPriceMinor: z.number().int(),
  reorderLevel: z.number().int(),
  unit: z.enum(UNITS),
  status: z.enum(["active", "inactive"]),
  /** on-hand quantity at the queried branch; null when no branchId filter was given */
  stockQuantity: z.number().int().nullable(),
  /** true when stockQuantity ≤ reorderLevel (only meaningful with a branchId) */
  lowStock: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Product = z.infer<typeof ProductSchema>;
