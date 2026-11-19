import "reflect-metadata";
import * as argon2 from "argon2";
import { PrismaClient } from "@prisma/client";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLE_NAMES_AR, SYSTEM_ROLES } from "@keystonehr/shared";

/**
 * Dev/staging seed: demo tenant + super admin + one branch of each type.
 * Runs on the DIRECT (owner) connection — RLS does not apply to seeding.
 *
 *   Login: admin@demo.hayryou / Admin@12345
 */
const db = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL } },
});

async function main() {
  const existing = await db.tenant.findUnique({ where: { slug: "demo" } });
  if (existing) {
    // Idempotent top-up: the base tenant (roles/admin/branches) is already here,
    // but an older seed predates later modules. Reconcile system-role permissions
    // against the current catalog (so new modules like Payroll/Leave are usable)
    // and add any missing operational demo data — no destructive reset needed.
    await ensureRolePermissions(existing.id);
    const mainBranch = await db.branch.findFirst({ where: { tenantId: existing.id, code: "BR-0001" } });
    const salalahBranch = await db.branch.findFirst({ where: { tenantId: existing.id, code: "BR-0002" } });
    const mirbatBranch = await db.branch.findFirst({ where: { tenantId: existing.id, code: "BR-0003" } });
    const barberRoleId = (
      await db.role.findFirst({ where: { tenantId: existing.id, isBarber: true } })
    )?.id;
    const managerRoleId = (
      await db.role.findFirst({ where: { tenantId: existing.id, nameEn: "Branch Manager" } })
    )?.id;
    if (mainBranch && salalahBranch && mirbatBranch && barberRoleId && managerRoleId) {
      await ensureOperationalData(
        existing,
        { main: mainBranch, salalah: salalahBranch, mirbat: mirbatBranch },
        { barber: barberRoleId, manager: managerRoleId },
      );
    }
    console.log("Seed: demo tenant exists — reconciled role permissions + operational data");
    return;
  }

  const tenant = await db.tenant.create({
    data: { name: "Keystone HR Demo Salon", slug: "demo" },
  });

  const roleIdsByName = new Map<string, string>();
  for (const [roleName, keys] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.create({
      data: {
        tenantId: tenant.id,
        nameEn: roleName,
        nameAr: SYSTEM_ROLE_NAMES_AR[roleName] ?? roleName,
        isSystem: true,
        isSuperAdmin: roleName === "Super Admin",
        isBarber: roleName === "Barber",
        permissions: {
          create: (keys === "*" ? ALL_PERMISSION_KEYS : [...keys]).map((permissionKey) => ({
            tenantId: tenant.id,
            permissionKey,
          })),
        },
      },
    });
    roleIdsByName.set(roleName, role.id);
  }

  const passwordHash = await argon2.hash("Admin@12345", { type: argon2.argon2id });
  await db.user.create({
    data: {
      tenantId: tenant.id,
      name: "Demo Admin",
      email: "admin@demo.hayryou",
      username: "admin",
      passwordHash,
      allBranches: true,
      roleId: roleIdsByName.get("Super Admin")!,
    },
  });

  // default tax scheme — same shape TenantsService.provisionTenant creates
  const taxProfile = await db.taxProfile.create({
    data: {
      tenantId: tenant.id,
      name: "VAT",
      country: "OM",
      isDefault: true,
      components: {
        create: [{ tenantId: tenant.id, name: "VAT", ratePercent: 5, sortOrder: 0 }],
      },
    },
  });

  const workingHours = {
    openingTime: "09:00",
    closingTime: "22:00",
    weeklyOffDays: ["friday", "saturday"],
  };
  const mainBranch = await db.branch.create({
    data: {
      tenantId: tenant.id,
      code: "BR-0001",
      nameEn: "Muscat Main Branch",
      nameAr: "فرع مسقط الرئيسي",
      type: "corporate",
      currency: tenant.defaultCurrency,
      taxProfileId: taxProfile.id,
      mobile: "+96890000001",
      email: "muscat@demo.hayryou",
      country: "Oman",
      state: "Muscat",
      city: "Muscat",
      address: "Al Khuwair, Muscat",
      workingHours,
    },
  });

  // one franchise partner holding two branches — the multi-branch owner case
  const owner = await db.franchiseOwner.create({
    data: {
      tenantId: tenant.id,
      ownerName: "Said Al Balushi",
      companyName: "Dhofar Grooming LLC",
      commercialRegistrationNo: "CR-1234567",
      email: "said@dhofargrooming.om",
    },
  });
  const franchiseBranch = (code: string, nameEn: string, nameAr: string, city: string): Promise<BranchRow> =>
    db.branch.create({
      data: {
        tenantId: tenant.id,
        code,
        nameEn,
        nameAr,
        type: "franchise",
        currency: tenant.defaultCurrency,
        taxProfileId: taxProfile.id,
        mobile: "+96890000002",
        email: `${city.toLowerCase()}@demo.hayryou`,
        country: "Oman",
        state: "Dhofar",
        city,
        address: `${city} main street`,
        workingHours,
        franchiseDetails: {
          create: {
            tenantId: tenant.id,
            franchiseOwnerId: owner.id,
            agreementStartDate: new Date("2026-01-01"),
            agreementExpiryDate: new Date("2031-01-01"),
          },
        },
      },
    });
  const salalahBranch = await franchiseBranch("BR-0002", "Salalah Franchise", "فرع صلالة", "Salalah");
  const mirbatBranch = await franchiseBranch("BR-0003", "Mirbat Franchise", "فرع مرباط", "Mirbat");

  await ensureOperationalData(
    tenant,
    { main: mainBranch, salalah: salalahBranch, mirbat: mirbatBranch },
    { barber: roleIdsByName.get("Barber")!, manager: roleIdsByName.get("Branch Manager")! },
  );

  console.log("Seed complete. Login: admin@demo.hayryou / Admin@12345");
}

type TenantRow = { id: string };
type BranchRow = { id: string; currency: string };

/**
 * Grant each system role any catalog permission keys it is missing. Idempotent
 * (role_permissions is unique on [roleId, permissionKey], so re-running skips
 * duplicates). Keeps a tenant seeded before a module existed able to use it.
 */
async function ensureRolePermissions(tenantId: string): Promise<void> {
  for (const [roleName, keys] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.findFirst({ where: { tenantId, nameEn: roleName } });
    if (!role) continue;
    const want = keys === "*" ? ALL_PERMISSION_KEYS : [...keys];
    const have = new Set(
      (
        await db.rolePermission.findMany({
          where: { roleId: role.id },
          select: { permissionKey: true },
        })
      ).map((p) => p.permissionKey),
    );
    const missing = want.filter((k) => !have.has(k));
    if (missing.length === 0) continue;
    await db.rolePermission.createMany({
      data: missing.map((permissionKey) => ({ tenantId, roleId: role.id, permissionKey })),
      skipDuplicates: true,
    });
  }
}

/**
 * Catalogue + barbers + customers + a demo appointment per status. Idempotent:
 * safe to re-run — each section no-ops if its data already exists, so an older
 * demo tenant can be topped up without a destructive reset.
 */
async function ensureOperationalData(
  tenant: TenantRow,
  branches: { main: BranchRow; salalah: BranchRow; mirbat: BranchRow },
  roleIds: { barber: string; manager: string },
): Promise<void> {
  const mainBranch = branches.main;
  // Upsert by natural unique keys so a tenant with an unrelated partial catalogue
  // (e.g. hand-created test rows) is topped up deterministically, not skipped.
  const category = (nameEn: string, nameAr: string, sortOrder: number) =>
    db.serviceCategory.upsert({
      where: { tenantId_nameEn: { tenantId: tenant.id, nameEn } },
      create: { tenantId: tenant.id, nameEn, nameAr, sortOrder },
      update: {},
    });
  const hair = await category("Hair", "الشعر", 0);
  const beard = await category("Beard", "اللحية", 1);
  const service = (
    categoryId: string,
    nameEn: string,
    nameAr: string,
    durationMinutes: number,
    bufferMinutes: number,
    priceMinor: bigint,
  ) =>
    db.service.upsert({
      where: { tenantId_nameEn: { tenantId: tenant.id, nameEn } },
      create: { tenantId: tenant.id, categoryId, nameEn, nameAr, durationMinutes, bufferMinutes, priceMinor },
      update: {},
    });
  const svc = {
    Haircut: await service(hair.id, "Haircut", "قص شعر", 30, 5, 8000n),
    "Hair Color": await service(hair.id, "Hair Color", "صبغ الشعر", 90, 15, 25000n),
    "Kids Cut": await service(hair.id, "Kids Cut", "قص شعر أطفال", 20, 0, 5000n),
    "Beard Trim": await service(beard.id, "Beard Trim", "تهذيب اللحية", 20, 0, 4000n),
    "Royal Shave": await service(beard.id, "Royal Shave", "حلاقة ملكية", 30, 5, 6000n),
  };

  // Full mandatory-field StaffProfile for every demo staff member below, so none of them are
  // invisible to Payroll/Leave/Attendance (which all require a StaffProfile row to query against).
  // Self-heals a pre-existing user from an older seed run that predates StaffProfile here.
  const upsertStaffMember = async (params: {
    name: string;
    username: string;
    password: string;
    roleId: string;
    branchId: string;
    mobile: string;
    gender: "male" | "female";
    employmentType: "full_time" | "part_time" | "contract";
    baseSalaryMinor: number;
    joiningDate: Date;
  }) => {
    const user = await db.user.upsert({
      where: { tenantId_username: { tenantId: tenant.id, username: params.username } },
      create: {
        tenantId: tenant.id,
        name: params.name,
        email: `${params.username}@demo.hayryou`,
        username: params.username,
        passwordHash: await argon2.hash(params.password, { type: argon2.argon2id }),
        roleId: params.roleId,
        allBranches: false,
        branchAssignments: { create: { tenantId: tenant.id, branchId: params.branchId } },
      },
      update: {},
    });
    if (!(await db.staffProfile.findUnique({ where: { userId: user.id } }))) {
      await db.staffProfile.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          mobile: params.mobile,
          gender: params.gender,
          staffStatus: "active",
          primaryBranchId: params.branchId,
          employmentType: params.employmentType,
          joiningDate: params.joiningDate,
          baseSalaryMinor: BigInt(params.baseSalaryMinor),
        },
      });
    }
    return user;
  };

  const barber = (name: string, username: string, mobile: string, baseSalaryMinor: number, joiningDate: Date) =>
    upsertStaffMember({
      name,
      username,
      password: "Barber@12345",
      roleId: roleIds.barber,
      branchId: mainBranch.id,
      mobile,
      gender: "male",
      employmentType: "full_time",
      baseSalaryMinor,
      joiningDate,
    });
  const barbers = {
    "Ahmed Al Rashdi": await barber("Ahmed Al Rashdi", "ahmed", "+96890020001", 350000, new Date("2025-03-01")),
    "Yousef Al Harthy": await barber("Yousef Al Harthy", "yousef", "+96890020002", 320000, new Date("2025-06-15")),
    "Bilal Khan": await barber("Bilal Khan", "bilal", "+96890020003", 300000, new Date("2026-01-10")),
  };

  // Extra demo staff across all 3 branches — a manager + a general staff member per branch — for
  // richer manual testing of Staff/Leave/Attendance/Payroll (including branch-scoped permissions).
  const demoStaff = (
    name: string,
    username: string,
    roleId: string,
    branchId: string,
    mobile: string,
    baseSalaryMinor: number,
    joiningDate: Date,
  ) =>
    upsertStaffMember({
      name,
      username,
      password: "Staff@12345",
      roleId,
      branchId,
      mobile,
      gender: "male",
      employmentType: "full_time",
      baseSalaryMinor,
      joiningDate,
    });
  await demoStaff("John David", "john.david", roleIds.manager, branches.main.id, "+96890010001", 450000, new Date("2024-11-01"));
  await demoStaff("Melvin Rocha", "melvin.rocha", roleIds.barber, branches.main.id, "+96890010002", 290000, new Date("2025-07-20"));
  await demoStaff("Paul Fernandes", "paul.fernandes", roleIds.manager, branches.salalah.id, "+96890010003", 430000, new Date("2024-09-12"));
  await demoStaff("Martin Cruz", "martin.cruz", roleIds.barber, branches.salalah.id, "+96890010004", 280000, new Date("2025-09-05"));
  await demoStaff("Rashid Al Balushi", "rashid.albalushi", roleIds.manager, branches.mirbat.id, "+96890010005", 440000, new Date("2024-12-18"));
  await demoStaff("Kevin Dsouza", "kevin.dsouza", roleIds.barber, branches.mirbat.id, "+96890010006", 300000, new Date("2026-02-01"));

  const customer = (mobile: string, name: string, tier: "gold" | "bronze") =>
    db.customer.upsert({
      where: { tenantId_mobile: { tenantId: tenant.id, mobile } },
      create: { tenantId: tenant.id, mobile, name, tier },
      update: {},
    });
  const fatima = await customer("+96891111111", "Fatima Al Zadjali", "gold");
  const omar = await customer("+96892222222", "Omar Said", "bronze");

  // retail products with opening stock at the main branch (idempotent by SKU)
  const product = async (
    sku: string,
    nameEn: string,
    nameAr: string,
    brand: string,
    salePriceMinor: bigint,
    costPriceMinor: bigint,
    quantity: number,
  ) => {
    const p = await db.product.upsert({
      where: { tenantId_sku: { tenantId: tenant.id, sku } },
      create: { tenantId: tenant.id, sku, nameEn, nameAr, brand, salePriceMinor, costPriceMinor, reorderLevel: 5 },
      update: {},
    });
    await db.stockLevel.upsert({
      where: { branchId_productId: { branchId: mainBranch.id, productId: p.id } },
      create: { tenantId: tenant.id, branchId: mainBranch.id, productId: p.id, quantity },
      update: {},
    });
  };
  await product("PRD-POMADE", "Pomade", "بوماد", "Keystone HR", 3500n, 1500n, 24);
  await product("PRD-SHAMPOO", "Shampoo", "شامبو", "Keystone HR", 4000n, 1800n, 18);
  await product("PRD-BEARDOIL", "Beard Oil", "زيت اللحية", "Keystone HR", 5000n, 2200n, 3);

  // appointments are the only non-idempotent section — seed once
  if ((await db.appointment.count({ where: { tenantId: tenant.id } })) > 0) return;

  const at = (dayOffset: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  type SeedService = {
    id: string;
    nameEn: string;
    nameAr: string;
    durationMinutes: number;
    bufferMinutes: number;
    priceMinor: bigint;
  };
  let apptSeq = 0;
  const appointment = (
    status: "waiting" | "confirmed" | "in_progress" | "completed" | "cancelled",
    customerId: string | null,
    barberId: string,
    services: SeedService[],
    scheduledStart: Date,
  ) => {
    apptSeq += 1;
    const durationMinutes = services.reduce((s, sv) => s + sv.durationMinutes + sv.bufferMinutes, 0);
    const totalMinor = services.reduce((s, sv) => s + sv.priceMinor, 0n);
    const year = scheduledStart.getFullYear();
    return db.appointment.create({
      data: {
        tenantId: tenant.id,
        branchId: mainBranch.id,
        appointmentNo: `APT-${year}-${String(apptSeq).padStart(6, "0")}`,
        customerId,
        barberId,
        status,
        scheduledStart,
        scheduledEnd: new Date(scheduledStart.getTime() + durationMinutes * 60_000),
        durationMinutes,
        totalMinor,
        currency: mainBranch.currency,
        services: {
          create: services.map((sv) => ({
            tenantId: tenant.id,
            serviceId: sv.id,
            nameEn: sv.nameEn,
            nameAr: sv.nameAr,
            priceMinor: sv.priceMinor,
            durationMinutes: sv.durationMinutes,
            bufferMinutes: sv.bufferMinutes,
          })),
        },
        history: { create: { tenantId: tenant.id, fromStatus: null, toStatus: status } },
      },
    });
  };
  await appointment("waiting", fatima.id, barbers["Ahmed Al Rashdi"].id, [svc.Haircut], at(0, 10));
  await appointment(
    "confirmed",
    omar.id,
    barbers["Yousef Al Harthy"].id,
    [svc["Beard Trim"], svc["Royal Shave"]],
    at(0, 11),
  );
  await appointment("in_progress", null, barbers["Bilal Khan"].id, [svc.Haircut], at(0, 12));
  await appointment(
    "completed",
    fatima.id,
    barbers["Ahmed Al Rashdi"].id,
    [svc["Hair Color"]],
    at(-1, 15),
  );
  await appointment("cancelled", omar.id, barbers["Yousef Al Harthy"].id, [svc["Kids Cut"]], at(0, 9));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
