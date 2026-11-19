import { z } from "zod";
import { MobileSchema, PaginationQuerySchema } from "./common";

export const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export const WorkingHoursSchema = z.object({
  openingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), // "09:00"
  closingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /**
   * Days with no operating hours (e.g. a 2-day Fri+Sat GCC weekend). Order-
   * independent, no duplicates. Read by [attendance](../../../docs/MODULES/attendance.md)
   * to derive the "Weekly Off" attendance status — was a single nullable
   * `weeklyOffDay` before the 2026-09 Attendance module design confirmed a
   * real multi-day weekend is required.
   */
  weeklyOffDays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
});

/** Create a new franchise partner inline while creating a branch. */
export const NewFranchiseOwnerSchema = z.object({
  ownerName: z.string().min(1).max(200),
  companyName: z.string().min(1).max(200),
  commercialRegistrationNo: z.string().min(1).max(100),
  taxNumber: z.string().max(100).nullable().optional(),
  email: z.string().email().nullable().optional(),
  mobile: z.string().max(20).nullable().optional(),
});
export type NewFranchiseOwnerInput = z.infer<typeof NewFranchiseOwnerSchema>;

/**
 * Franchise link for a branch: pick an EXISTING owner (multi-branch owners)
 * or create a new one inline. The agreement is always per branch.
 */
const FranchiseDetailsSchema = z
  .object({
    franchiseOwnerId: z.string().uuid().optional(),
    newOwner: NewFranchiseOwnerSchema.optional(),
    agreementStartDate: z.coerce.date(),
    agreementExpiryDate: z.coerce.date(),
  })
  .refine((v) => !!v.franchiseOwnerId !== !!v.newOwner, {
    message: "Provide either franchiseOwnerId or newOwner (exactly one)",
    path: ["franchiseOwnerId"],
  });

export const CreateBranchSchema = z
  .object({
    nameEn: z.string().min(1).max(100),
    nameAr: z.string().min(1).max(100),
    type: z.enum(["corporate", "franchise"]),
    status: z.enum(["active", "inactive"]).default("active"),
    managerUserId: z.string().uuid().nullable().optional(),

    mobile: MobileSchema,
    landphone: z.string().max(20).nullable().optional(),
    email: z.string().email(),
    whatsapp: z.string().max(20).nullable().optional(),

    country: z.string().min(1).max(100),
    state: z.string().min(1).max(100),
    city: z.string().min(1).max(100),
    address: z.string().min(1).max(500),
    googleMapsUrl: z.string().url().nullable().optional(),

    workingHours: WorkingHoursSchema,

    /** ISO 4217. Omitted → inherits the tenant's default currency. */
    currency: z.string().length(3).optional(),
    /**
     * Tax scheme for this branch (configured in Settings → tax profiles).
     * Omitted → inherits the tenant's default profile. Explicit null → tax-free.
     */
    taxProfileId: z.string().uuid().nullable().optional(),

    /** Physical capacity: number of styling chairs available at this branch. */
    chairCount: z.number().int().min(1).max(100).default(1),

    allowOnlineBooking: z.boolean().default(true),
    allowWalkIns: z.boolean().default(true),
    enableLoyalty: z.boolean().default(true),
    enableProductSales: z.boolean().default(true),

    /**
     * Active services offered at this branch. Omitted → leave untouched (on
     * create, this means "all active services offered at base price", the
     * same as the Services module's default). An explicit `[]` is a real
     * "turn everything off" signal, distinct from "not sent".
     */
    serviceIds: z.array(z.string().uuid()).max(200).optional(),

    franchiseDetails: FranchiseDetailsSchema.nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "franchise" && !val.franchiseDetails) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["franchiseDetails"],
        message: "Franchise details are required for franchise branches",
      });
    }
  });
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.innerType().partial();
export type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;

export const ListBranchesQuerySchema = PaginationQuerySchema.extend({
  type: z.enum(["corporate", "franchise"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  city: z.string().max(100).optional(),
  /** filter all branches of one franchise partner */
  franchiseOwnerId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;

export const BranchSchema = z.object({
  id: z.string().uuid(),
  code: z.string(), // human-readable Store ID, immutable
  nameEn: z.string(),
  nameAr: z.string(),
  type: z.enum(["corporate", "franchise"]),
  status: z.enum(["active", "inactive"]),
  city: z.string(),
  country: z.string(),
  currency: z.string(),
  managerUserId: z.string().uuid().nullable(),
  manager: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** already stored/returned by the API on every row — was missing from this response
   *  contract until the Appointments Day view (barber × time-slot grid) needed it. */
  workingHours: WorkingHoursSchema,
  /** active user assignments at this branch */
  staffCount: z.number().int(),
  chairCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Branch = z.infer<typeof BranchSchema>;

/**
 * Branch list KPI cards. Appointment KPIs join when that module lands
 * (docs/MODULES/branches.md).
 */
export const BranchStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  /** distinct active users assigned to (in-scope) branches */
  staff: z.number().int(),
  /**
   * Total revenue across in-scope branches, in minor units of `revenueCurrency`.
   * `null` until the POS/finance module lands — the UI renders an empty state.
   * Never sum across differing currencies (docs/GLOBALIZATION.md); the aggregate
   * is expressed in the tenant default currency reported by `revenueCurrency`.
   */
  revenue: z.number().int().nullable(),
  /** ISO 4217 code the `revenue` figure is expressed in; `null` when revenue is null */
  revenueCurrency: z.string().nullable(),
});
export type BranchStats = z.infer<typeof BranchStatsSchema>;

export const ListFranchiseOwnersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().max(100).optional(),
});
export type ListFranchiseOwnersQuery = z.infer<typeof ListFranchiseOwnersQuerySchema>;

export const FranchiseOwnerSchema = z.object({
  id: z.string().uuid(),
  ownerName: z.string(),
  companyName: z.string(),
  commercialRegistrationNo: z.string(),
});
export type FranchiseOwner = z.infer<typeof FranchiseOwnerSchema>;
