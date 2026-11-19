/**
 * THE source of truth for permission keys — there is no `permissions` table.
 * `role_permissions.permission_key` rows must match values here.
 * Convention: `module.action`. Add keys here first, then use in @Permissions().
 */
export const PERMISSIONS = {
  // Dashboard
  "dashboard.view": "View dashboard KPIs",

  // Branches
  "branches.view": "View branches",
  "branches.create": "Create branches",
  "branches.update": "Edit branches",
  "branches.deactivate": "Activate/deactivate branches",

  // Customers
  "customers.view": "View customers",
  "customers.create": "Create customers",
  "customers.update": "Edit customers",
  "customers.delete": "Delete customers",
  "customers.export": "Export customer lists",

  // Appointments
  "appointments.view": "View appointments",
  "appointments.create": "Book appointments",
  "appointments.update": "Edit/reschedule appointments",
  "appointments.cancel": "Cancel appointments",
  "appointments.checkin": "Check in / progress / complete appointments",

  // POS
  "pos.use": "Open POS and create sales",
  "pos.discount.manual": "Apply manual discounts",
  "pos.refund": "Process refunds/voids",
  "invoices.view": "View invoices and receipts",

  // Walk-in Queue
  "walkin.view": "View walk-in queue",
  "walkin.create": "Register walk-in customers",
  "walkin.update": "Edit/reassign walk-in queue entries",
  "walkin.cancel": "Cancel walk-in queue entries",
  "walkin.checkin": "Start / complete walk-in services",

  // Services catalog
  "services.view": "View services",
  "services.manage": "Create/edit services and categories",

  // Staff
  "staff.view": "View staff",
  "staff.create": "Create staff",
  "staff.update": "Edit staff",
  "staff.employment.manage": "Manage salary/commission/contracts",

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
  "leave.request": "Request leave (own or on a staff member's behalf)",
  "leave.view": "View leave requests",
  "leave.approve": "Approve/reject leave requests",
  "leave.settings.manage": "Configure leave types (Settings > Leave Settings)",

  // Inventory
  "inventory.view": "View inventory",
  "inventory.manage": "Create/edit items, adjust stock",
  "inventory.transfer": "Transfer stock between branches",

  // Procurement
  "procurement.view": "View procurement",
  "procurement.request.create": "Create purchase requests",
  "procurement.request.approve": "Approve/reject purchase requests",
  "procurement.order.manage": "Create/manage purchase orders and GRNs",

  // Loyalty
  "loyalty.view": "View loyalty data",
  "loyalty.redeem": "Redeem points at POS/booking",
  "loyalty.adjust": "Manually adjust points",
  "loyalty.rules.manage": "Configure earn rules and tiers",

  // Finance
  "finance.view": "View finance data and reports",
  "finance.manage": "Record expenses/payments",

  // Roles
  "roles.manage": "Create/edit roles and permissions",

  // Taxes
  "taxes.view": "View tax profiles",
  "taxes.manage": "Create/edit tax profiles and components",

  // Settings & audit
  "settings.manage": "Manage tenant settings",
  "settings.company.manage": "Manage tenant/company profile (Settings > Company Info)",
  "settings.general.manage": "Manage tenant general settings (Settings > General Settings)",
  "audit.view": "View audit logs",
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export const ALL_PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Arabic display names for the seeded system roles — `SYSTEM_ROLES`' keys stay the stable
 *  English identifier used for lookups/seeding; this is the only place their Arabic form lives. */
export const SYSTEM_ROLE_NAMES_AR: Record<string, string> = {
  "Super Admin": "مسؤول عام",
  "Operations Manager": "مدير العمليات",
  "Branch Manager": "مدير الفرع",
  Receptionist: "موظف استقبال",
  Barber: "حلاق",
  Cashier: "أمين الصندوق",
  Accountant: "محاسب",
};

/** Seeded system roles and their permission sets. Tenants can add custom roles. */
export const SYSTEM_ROLES: Record<string, readonly PermissionKey[] | "*"> = {
  "Super Admin": "*",
  "Operations Manager": [
    "dashboard.view",
    "branches.view",
    "branches.update",
    "customers.view",
    "customers.export",
    "appointments.view",
    "walkin.view",
    "services.view",
    "services.manage",
    "staff.view",
    "staff.update",
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
    "inventory.view",
    "inventory.manage",
    "inventory.transfer",
    "procurement.view",
    "procurement.request.approve",
    "procurement.order.manage",
    "loyalty.view",
    "loyalty.rules.manage",
    "finance.view",
    "invoices.view",
    "taxes.view",
    "taxes.manage",
    "settings.company.manage",
    "settings.general.manage",
    "audit.view",
  ],
  "Branch Manager": [
    "dashboard.view",
    "branches.view",
    "customers.view",
    "customers.create",
    "customers.update",
    "appointments.view",
    "appointments.create",
    "appointments.update",
    "appointments.cancel",
    "appointments.checkin",
    "pos.use",
    "pos.discount.manual",
    "pos.refund",
    "invoices.view",
    "walkin.view",
    "walkin.create",
    "walkin.update",
    "walkin.cancel",
    "walkin.checkin",
    "services.view",
    "staff.view",
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
    "inventory.view",
    "inventory.manage",
    "procurement.view",
    "procurement.request.create",
    "loyalty.view",
    "loyalty.redeem",
    "finance.view",
    "taxes.view",
  ],
  Receptionist: [
    "dashboard.view",
    "customers.view",
    "customers.create",
    "customers.update",
    "appointments.view",
    "appointments.create",
    "appointments.update",
    "appointments.checkin",
    "pos.use",
    "invoices.view",
    "walkin.view",
    "walkin.create",
    "walkin.update",
    "walkin.cancel",
    "walkin.checkin",
    "services.view",
    "loyalty.view",
    "loyalty.redeem",
    "attendance.mark",
    "leave.request",
  ],
  Barber: [
    "dashboard.view",
    "appointments.view",
    "walkin.view",
    "services.view",
    "customers.view",
    "attendance.mark",
    "leave.request",
  ],
  Cashier: [
    "dashboard.view",
    "pos.use",
    "invoices.view",
    "walkin.view",
    "walkin.create",
    "walkin.update",
    "walkin.cancel",
    "walkin.checkin",
    "customers.view",
    "customers.create",
    "loyalty.view",
    "loyalty.redeem",
    "attendance.mark",
    "leave.request",
  ],
  Accountant: [
    "dashboard.view",
    "finance.view",
    "finance.manage",
    "invoices.view",
    "taxes.view",
    "audit.view",
    "attendance.mark",
    "leave.request",
    "payroll.view",
    "payroll.generate",
    "payroll.edit",
    "payroll.approve",
    "payroll.reject",
    "payroll.mark_paid",
  ],
};
