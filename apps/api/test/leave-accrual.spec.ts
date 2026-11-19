import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, validBranchPayload, type TestAdmin } from "./helpers";
import { PrismaService } from "../src/database/prisma.service";
import { runLeaveAccrualJob } from "../src/modules/leave/leave-accrual.job";

describe("leave balance accrual job", () => {
  let app: INestApplication;
  let admin: TestAdmin;
  let db: PrismaService;
  let branchId: string;
  let managerRoleId: string;
  let mobileCounter = 91000000;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function todayUtc(): Date {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  async function createStaff(joiningDate: Date): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const username = `accrual-staff-${suffix}`;
    const res = await request()
      .post("/api/v1/employees")
      .set(auth(admin.accessToken))
      .send({
        name: `Accrual Staff ${suffix}`,
        username,
        email: `${username}@test.keystonehr`,
        mobile: `+971${++mobileCounter}`,
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor: 100000,
      })
      .expect(201);
    const profile = await db.client.employeeProfile.findUniqueOrThrow({ where: { userId: res.body.id } });
    // joiningDate isn't settable via the create-user API — set it directly for deterministic tests.
    await db.client.employeeProfile.update({ where: { id: profile.id }, data: { joiningDate } });
    return profile.id;
  }

  async function createLeaveType(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request()
      .post("/api/v1/leave-types")
      .set(auth(admin.accessToken))
      .send({
        nameEn: `Accrual Type ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة",
        daysPerYear: 24,
        countMode: "all_days",
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  async function getBalanceRow(employeeProfileId: string, leaveTypeId: string, year: number) {
    return db.client.leaveBalance.findUnique({
      where: { employeeProfileId_leaveTypeId_year: { employeeProfileId, leaveTypeId, year } },
    });
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    admin = await createTestAdmin(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(admin.accessToken))
      .send(validBranchPayload("Accrual Branch"))
      .expect(201);
    branchId = branch.body.id;

    const roles = await request().get("/api/v1/roles").set(auth(admin.accessToken)).expect(200);
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("beginning_of_year: credits the full daysPerYear once, and does not double-credit on a second run", async () => {
    const today = todayUtc();
    const staffId = await createStaff(new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)));
    const typeId = await createLeaveType({ daysPerYear: 24, creditPolicy: "beginning_of_year" });

    await runLeaveAccrualJob(db);
    const after1 = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(after1!.accrued)).toBe(24);

    await runLeaveAccrualJob(db);
    const after2 = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(after2!.accrued)).toBe(24);
  });

  it("monthly: credits daysPerYear/12 and catches up after a simulated missed period, without double-crediting", async () => {
    const today = todayUtc();
    const staffId = await createStaff(new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)));
    const typeId = await createLeaveType({ daysPerYear: 12, creditPolicy: "beginning_of_month" });

    await runLeaveAccrualJob(db);
    const after1 = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(after1!.accrued)).toBe(1);

    // same month again — must not double-credit
    await runLeaveAccrualJob(db);
    const after2 = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(after2!.accrued)).toBe(1);

    // simulate the job having missed a couple of months
    const twoMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 1));
    await db.client.leaveBalance.update({ where: { id: after2!.id }, data: { lastAccruedAt: twoMonthsAgo } });

    await runLeaveAccrualJob(db);
    const after3 = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(after3!.accrued)).toBe(2); // resumes for the current period, not back-filled per missed month
  });

  it("anniversary: credits only on/after the staff's join month+day this year", async () => {
    const today = todayUtc();
    const typeId = await createLeaveType({ daysPerYear: 24, creditPolicy: "anniversary" });

    // anniversary falls tomorrow this year — not due yet
    const notYetJoin = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate() + 1));
    const notYetStaffId = await createStaff(notYetJoin);

    // anniversary fell yesterday this year — due
    const alreadyJoin = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate() - 1));
    const alreadyStaffId = await createStaff(alreadyJoin);

    await runLeaveAccrualJob(db);

    const notYetBalance = await getBalanceRow(notYetStaffId, typeId, today.getUTCFullYear());
    expect(notYetBalance === null || Number(notYetBalance.accrued) === 0).toBe(true);

    const alreadyBalance = await getBalanceRow(alreadyStaffId, typeId, today.getUTCFullYear());
    expect(Number(alreadyBalance!.accrued)).toBe(24);
  });

  it("a new joiner (joining tomorrow) is skipped entirely — no backdated credit", async () => {
    const today = todayUtc();
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const staffId = await createStaff(tomorrow);
    const typeId = await createLeaveType({ daysPerYear: 24, creditPolicy: "beginning_of_year" });

    await runLeaveAccrualJob(db);
    const balance = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(balance).toBeNull();
  });

  it("year-rollover: a new year's balance carries forward the prior year's closing balance, capped at maxCarryForwardDays", async () => {
    const today = todayUtc();
    // Leave type created before the staff member exists, so LeaveTypesService's eager
    // creation-time accrual (no eligible staff yet) doesn't pre-create this year's balance row —
    // that row must come from runLeaveAccrualJob below, seeded from last year's balance.
    const typeId = await createLeaveType({
      daysPerYear: 24,
      creditPolicy: "beginning_of_year",
      allowCarryForward: true,
      maxCarryForwardDays: 5,
    });
    const staffId = await createStaff(new Date(Date.UTC(today.getUTCFullYear() - 2, 0, 1)));

    // seed last year's balance directly: accrued 10, used 2 -> closing 8, capped at maxCarryForwardDays (5)
    await db.client.leaveBalance.create({
      data: {
        employeeProfileId: staffId,
        leaveTypeId: typeId,
        year: today.getUTCFullYear() - 1,
        openingBalance: 0,
        accrued: 10,
        used: 2,
        carriedForward: 0,
      },
    });

    await runLeaveAccrualJob(db);
    const currentYearBalance = await getBalanceRow(staffId, typeId, today.getUTCFullYear());
    expect(Number(currentYearBalance!.carriedForward)).toBe(5);
  });
});
