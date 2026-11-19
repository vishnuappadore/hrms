import { z } from "zod";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "../permissions";
import { PaginationQuerySchema } from "./common";

/**
 * Password policy for admin-set passwords. The client spec leaves the exact
 * policy open (docs/MODULES/auth.md); this is the product-wide default.
 */
export const PasswordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, "Must contain a letter")
  .regex(/[0-9]/, "Must contain a digit");

/** Shared by CreateUserSchema and staff.ts's CreateStaffSchema. */
export function assertBranchAssignment(
  v: { allBranches: boolean; branchIds: string[] },
  ctx: z.RefinementCtx,
): void {
  if (!v.allBranches && v.branchIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["branchIds"],
      message: "Assign at least one branch, or grant all-branches access",
    });
  }
}

export const CreateUserSchema = z
  .object({
    name: z.string().min(1).max(120),
    username: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-zA-Z0-9._-]+$/, "Letters, digits, dot, underscore and dash only"),
    email: z.string().email().max(254).nullable().optional(),
    password: PasswordSchema,
    roleId: z.string().uuid(),
    status: z.enum(["active", "inactive"]).default("active"),
    locale: z.enum(["en", "ar"]).default("en"),
    /** Sees every branch without assignments (Super Admin style). */
    allBranches: z.boolean().default(false),
    branchIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine(assertBranchAssignment);
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Password changes go through the dedicated reset endpoint.
 * The allBranches/branchIds invariant is enforced by the service against the
 * FINAL state, since a partial payload may update either side alone.
 */
export const UpdateUserSchema = CreateUserSchema.innerType().omit({ password: true }).partial();
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const ResetUserPasswordSchema = z.object({ password: PasswordSchema });
export type ResetUserPasswordInput = z.infer<typeof ResetUserPasswordSchema>;

export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  roleId: z.string().uuid().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  /** only users assigned to this branch (allBranches users are not matched) */
  branchId: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

/** API response shape — passwordHash must never appear here. */
export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().nullable(),
  username: z.string(),
  /** From the linked StaffProfile — null for a user with no staff profile. */
  mobile: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  locale: z.enum(["en", "ar"]),
  allBranches: z.boolean(),
  role: z.object({ id: z.string().uuid(), nameEn: z.string(), nameAr: z.string() }),
  branchIds: z.array(z.string().uuid()),
  lastLoginAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type User = z.infer<typeof UserSchema>;

export const RoleSchema = z.object({
  id: z.string().uuid(),
  nameEn: z.string(),
  nameAr: z.string(),
  isSystem: z.boolean(),
  isSuperAdmin: z.boolean(),
});
export type Role = z.infer<typeof RoleSchema>;

/** `/settings/roles` list — adds how many staff currently hold each role (blocks deletion if > 0). */
export const RoleSummarySchema = RoleSchema.extend({
  staffCount: z.number().int(),
});
export type RoleSummary = z.infer<typeof RoleSummarySchema>;

const PERMISSION_KEYS_FIELD = z.array(z.enum(ALL_PERMISSION_KEYS as [PermissionKey, ...PermissionKey[]]));

/** A role is just a named set of permission keys — see `@keystonehr/shared` PERMISSIONS for the catalog. */
export const RoleDetailSchema = RoleSummarySchema.extend({
  permissionKeys: PERMISSION_KEYS_FIELD,
});
export type RoleDetail = z.infer<typeof RoleDetailSchema>;

export const CreateRoleSchema = z.object({
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  permissionKeys: PERMISSION_KEYS_FIELD,
});
export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  nameEn: z.string().trim().min(1).max(100),
  nameAr: z.string().trim().min(1).max(100),
  /** Omit to rename only — the role's permissions are left untouched. */
  permissionKeys: PERMISSION_KEYS_FIELD.optional(),
});
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
