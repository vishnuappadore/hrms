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
   * Days with no operating hours (e.g. the UAE's Sat+Sun weekend). Order-
   * independent, no duplicates. Read by Attendance to derive the
   * "Weekly Off" attendance status.
   */
  weeklyOffDays: z.array(z.enum(WEEKDAYS)).max(7).default([]),
});

export const CreateBranchSchema = z.object({
  nameEn: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100),
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

  /** ISO 4217. Omitted → inherits the company's default currency (AED). */
  currency: z.string().length(3).optional(),
});
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

export const UpdateBranchSchema = CreateBranchSchema.partial();
export type UpdateBranchInput = z.infer<typeof UpdateBranchSchema>;

export const ListBranchesQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["active", "inactive"]).optional(),
  city: z.string().max(100).optional(),
  search: z.string().max(100).optional(),
});
export type ListBranchesQuery = z.infer<typeof ListBranchesQuerySchema>;

export const BranchSchema = z.object({
  id: z.string().uuid(),
  code: z.string(), // human-readable Store ID, immutable
  nameEn: z.string(),
  nameAr: z.string(),
  status: z.enum(["active", "inactive"]),
  city: z.string(),
  country: z.string(),
  currency: z.string(),
  managerUserId: z.string().uuid().nullable(),
  manager: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  workingHours: WorkingHoursSchema,
  /** active user assignments at this branch */
  employeeCount: z.number().int(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Branch = z.infer<typeof BranchSchema>;

/** Branch list KPI cards. */
export const BranchStatsSchema = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  /** distinct active users assigned to (in-scope) branches */
  employees: z.number().int(),
});
export type BranchStats = z.infer<typeof BranchStatsSchema>;
