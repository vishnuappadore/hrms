import "reflect-metadata";
import * as argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_NAMES_AR, SYSTEM_ROLES } from "@keystonehr/shared";

/**
 * Dev/staging seed: the single company row + system roles + Super Admin +
 * a handful of demo branches/employees/leave types so every kept module
 * (Employees, Attendance, Leave, Payroll, Branches, Roles & Permissions,
 * Settings) has something to show on first run.
 *
 *   Login: admin@demo.keystonehr / Admin@12345
 */
const db = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const COMPANY_SETTINGS_ID = "default";

async function main() {
  const company = await db.companySettings.upsert({
    where: { id: COMPANY_SETTINGS_ID },
    create: {
      id: COMPANY_SETTINGS_ID,
      name: "Keystone HR Demo Company",
      defaultLocale: "en",
      defaultCurrency: "AED",
      timezone: "Asia/Dubai",
      contactEmail: "info@demo.keystonehr",
      address: "Business Bay, Dubai, United Arab Emirates",
    },
    update: {},
  });

  const roleIdsByName = await ensureRoles();

  const workingHours = {
    openingTime: "09:00",
    closingTime: "18:00",
    weeklyOffDays: ["friday", "saturday"],
  };
  const branch = (code: string, nameEn: string, nameAr: string, city: string, mobile: string) =>
    db.branch.upsert({
      where: { code },
      create: {
        code,
        nameEn,
        nameAr,
        currency: company.defaultCurrency,
        mobile,
        email: `${city.toLowerCase()}@demo.keystonehr`,
        country: "United Arab Emirates",
        state: city,
        city,
        address: `${city}, UAE`,
        workingHours,
      },
      update: {},
    });
  const mainBranch = await branch("BR-0001", "Dubai HQ", "المكتب الرئيسي - دبي", "Dubai", "+971500000001");
  const abuDhabiBranch = await branch("BR-0002", "Abu Dhabi Branch", "فرع أبوظبي", "Abu Dhabi", "+971500000002");
  const sharjahBranch = await branch("BR-0003", "Sharjah Branch", "فرع الشارقة", "Sharjah", "+971500000003");

  const passwordHash = await argon2.hash("Admin@12345", { type: argon2.argon2id });
  const admin = await db.user.upsert({
    where: { username: "admin" },
    create: {
      name: "Demo Admin",
      email: "admin@demo.keystonehr",
      username: "admin",
      passwordHash,
      allBranches: true,
      roleId: roleIdsByName.get("Super Admin")!,
    },
    update: {},
  });
  await db.employeeProfile.upsert({
    where: { userId: admin.id },
    create: {
      userId: admin.id,
      mobile: "+971500000000",
      gender: "male",
      employeeStatus: "active",
      primaryBranchId: mainBranch.id,
      employmentType: "full_time",
      joiningDate: new Date("2024-01-01"),
      baseSalaryMinor: 0n,
    },
    update: {},
  });

  await ensureLeaveTypes();
  await ensurePayrollComponents();
  await ensureDemoEmployees(
    { main: mainBranch, abuDhabi: abuDhabiBranch, sharjah: sharjahBranch },
    { manager: roleIdsByName.get("Branch Manager")!, employee: roleIdsByName.get("Employee")! },
  );

  console.log("Seed complete. Login: admin@demo.keystonehr / Admin@12345");
}

type BranchRow = { id: string; currency: string };

/**
 * Creates each system role on first run; on a re-run, tops up any catalog
 * permission keys a role is missing (role_permissions is unique on
 * [roleId, permissionKey], so this is always safe to repeat) — keeps an
 * older seeded database usable after the permission catalog grows.
 */
async function ensureRoles(): Promise<Map<string, string>> {
  const roleIdsByName = new Map<string, string>();
  for (const [roleName, keys] of Object.entries(SYSTEM_ROLES)) {
    const wantedKeys = keys === "*" ? ALL_PERMISSION_KEYS : [...keys];
    const role = await db.role.upsert({
      where: { nameEn: roleName },
      create: {
        nameEn: roleName,
        nameAr: SYSTEM_ROLE_NAMES_AR[roleName] ?? roleName,
        isSystem: true,
        isSuperAdmin: roleName === "Super Admin",
        permissions: { create: wantedKeys.map((permissionKey) => ({ permissionKey })) },
      },
      update: {},
    });
    roleIdsByName.set(roleName, role.id);

    const have = new Set(
      (await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionKey: true } })).map(
        (p) => p.permissionKey,
      ),
    );
    const missing = wantedKeys.filter((k) => !have.has(k));
    if (missing.length > 0) {
      await db.rolePermission.createMany({
        data: missing.map((permissionKey) => ({ roleId: role.id, permissionKey })),
        skipDuplicates: true,
      });
    }
  }
  return roleIdsByName;
}

async function ensureLeaveTypes(): Promise<void> {
  const leaveType = (
    nameEn: string,
    nameAr: string,
    isPaid: boolean,
    daysPerYear: number,
    sortOrder: number,
  ) =>
    db.leaveType.upsert({
      where: { nameEn },
      create: { nameEn, nameAr, isPaid, daysPerYear, allowCarryForward: isPaid, maxCarryForwardDays: isPaid ? 5 : 0, sortOrder },
      update: {},
    });
  await leaveType("Annual Leave", "إجازة سنوية", true, 30, 0);
  await leaveType("Sick Leave", "إجازة مرضية", true, 15, 1);
  await leaveType("Unpaid Leave", "إجازة بدون راتب", false, 0, 2);
}

async function ensurePayrollComponents(): Promise<void> {
  const component = (
    category: "allowance" | "deduction",
    nameEn: string,
    nameAr: string,
    basis: "fixed_amount" | "percentage_of_base",
    defaultAmountMinor: bigint | null,
    defaultRatePct: number | null,
    sortOrder: number,
  ) =>
    db.payrollComponent.upsert({
      where: { nameEn },
      create: { category, nameEn, nameAr, basis, defaultAmountMinor, defaultRatePct, sortOrder },
      update: {},
    });
  await component("allowance", "Housing Allowance", "بدل سكن", "fixed_amount", 100000n, null, 0);
  await component("allowance", "Transport Allowance", "بدل مواصلات", "fixed_amount", 30000n, null, 1);
  await component("deduction", "Social Security", "التأمينات الاجتماعية", "percentage_of_base", null, 5, 0);
}

/**
 * A manager + an employee per branch, for manual testing of
 * Employees/Attendance/Leave/Payroll (including branch-scoped permissions).
 * Idempotent — safe to re-run.
 */
async function ensureDemoEmployees(
  branches: { main: BranchRow; abuDhabi: BranchRow; sharjah: BranchRow },
  roleIds: { manager: string; employee: string },
): Promise<void> {
  const upsertEmployee = async (params: {
    name: string;
    username: string;
    password: string;
    roleId: string;
    branchId: string;
    mobile: string;
    baseSalaryMinor: number;
    joiningDate: Date;
  }) => {
    const user = await db.user.upsert({
      where: { username: params.username },
      create: {
        name: params.name,
        email: `${params.username}@demo.keystonehr`,
        username: params.username,
        passwordHash: await argon2.hash(params.password, { type: argon2.argon2id }),
        roleId: params.roleId,
        allBranches: false,
        branchAssignments: { create: { branchId: params.branchId } },
      },
      update: {},
    });
    await db.employeeProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        mobile: params.mobile,
        gender: "male",
        employeeStatus: "active",
        primaryBranchId: params.branchId,
        employmentType: "full_time",
        joiningDate: params.joiningDate,
        baseSalaryMinor: BigInt(params.baseSalaryMinor),
      },
      update: {},
    });
    return user;
  };

  await upsertEmployee({
    name: "Fatima Al Suwaidi",
    username: "fatima.alsuwaidi",
    password: "Manager@12345",
    roleId: roleIds.manager,
    branchId: branches.main.id,
    mobile: "+971500010001",
    baseSalaryMinor: 1_200_000,
    joiningDate: new Date("2024-02-01"),
  });
  await upsertEmployee({
    name: "Omar Khalid",
    username: "omar.khalid",
    password: "Employee@12345",
    roleId: roleIds.employee,
    branchId: branches.main.id,
    mobile: "+971500010002",
    baseSalaryMinor: 700_000,
    joiningDate: new Date("2025-01-15"),
  });
  await upsertEmployee({
    name: "Noura Al Zaabi",
    username: "noura.alzaabi",
    password: "Manager@12345",
    roleId: roleIds.manager,
    branchId: branches.abuDhabi.id,
    mobile: "+971500010003",
    baseSalaryMinor: 1_150_000,
    joiningDate: new Date("2024-05-10"),
  });
  await upsertEmployee({
    name: "Yusuf Rahman",
    username: "yusuf.rahman",
    password: "Employee@12345",
    roleId: roleIds.employee,
    branchId: branches.sharjah.id,
    mobile: "+971500010004",
    baseSalaryMinor: 650_000,
    joiningDate: new Date("2025-03-20"),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
