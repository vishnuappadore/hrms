/**
 * THE source of truth for permission keys — there is no `permissions` table.
 * `role_permissions.permission_key` rows must match values here.
 * Convention: `module.action`. Add keys here first, then use in @Permissions().
 */
export const PERMISSIONS = {
  // Branches
  "branches.view": "View branches",
  "branches.create": "Create branches",
  "branches.update": "Edit branches",

  // Employees
  "employee.view": "View employees",
  "employee.create": "Create employees",
  "employee.update": "Edit employees",
  "employee.employment.manage": "Manage salary/commission/contracts",

  // Payroll
  "payroll.view": "View payroll runs and payslips",
  "payroll.generate": "Generate payroll runs",
  "payroll.edit": "Edit payslip allowances/deductions",
  "payroll.approve": "Approve payroll items",
  "payroll.reject": "Reject payroll items",
  "payroll.mark_paid": "Mark payroll items as paid",

  // Attendance
  "attendance.mark": "Check in / check out (own record)",
  "attendance.view": "View attendance logs",
  "attendance.edit": "Correct or manually add attendance entries",
  "attendance.export": "Export attendance lists",

  // Leave
  "leave.request": "Request leave (own or on an employee's behalf)",
  "leave.view": "View leave requests",
  "leave.approve": "Approve/reject leave requests",
  "leave.settings.manage": "Configure leave types (Settings > Leave Settings)",

  // Roles
  "roles.manage": "Create/edit roles and permissions",

  // Settings & audit
  "settings.manage": "Manage company settings (e.g. payroll components)",
  "settings.company.manage": "Manage company profile (Settings > Company Info)",
  "settings.general.manage": "Manage general settings (Settings > General Settings)",
  "audit.view": "View audit logs",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Arabic display names for the seeded system roles — `SYSTEM_ROLES`' keys stay the stable
 *  English identifier used for lookups/seeding; this is the only place their Arabic form lives. */
export const SYSTEM_ROLE_NAMES_AR: Record<string, string> = {
  "Super Admin": "مسؤول عام",
  "HR Manager": "مدير الموارد البشرية",
  "Branch Manager": "مدير الفرع",
  "Payroll Officer": "موظف الرواتب",
  Employee: "موظف",
};

/** Seeded system roles and their permission sets. Admins can add custom roles. */
export const SYSTEM_ROLES: Record<string, readonly PermissionKey[] | "*"> = {
  "Super Admin": "*",
  "HR Manager": [
    "branches.view",
    "branches.create",
    "branches.update",
    "employee.view",
    "employee.create",
    "employee.update",
    "employee.employment.manage",
    "payroll.view",
    "payroll.generate",
    "payroll.edit",
    "payroll.approve",
    "payroll.reject",
    "payroll.mark_paid",
    "attendance.mark",
    "attendance.view",
    "attendance.edit",
    "attendance.export",
    "leave.request",
    "leave.view",
    "leave.approve",
    "leave.settings.manage",
    "settings.manage",
    "settings.company.manage",
    "settings.general.manage",
    "audit.view",
  ],
  "Branch Manager": [
    "branches.view",
    "employee.view",
    "attendance.view",
    "attendance.edit",
    "leave.view",
    "leave.approve",
    "payroll.view",
    "attendance.mark",
    "leave.request",
  ],
  "Payroll Officer": [
    "employee.view",
    "payroll.view",
    "payroll.generate",
    "payroll.edit",
    "payroll.approve",
    "payroll.reject",
    "payroll.mark_paid",
    "settings.manage",
    "attendance.mark",
    "leave.request",
  ],
  Employee: ["attendance.mark", "leave.request"],
};
