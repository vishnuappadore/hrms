import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createUserWithRole, provisionTenant, validBranchPayload, type TestTenant } from "./helpers";
import { AuthPrismaService } from "../src/database/auth-prisma.service";

describe("leave types (Settings > Leave Settings)", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantB: TestTenant;
  let db: AuthPrismaService;
  let branchId: string;
  let managerRoleId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let mobileCounter = 90000000;
  /** A staff member eligible for accrual as of `today` — pass a past/null `joiningDate` for an
   * eligible one, or a future date to exercise the "not yet eligible" exclusion. Returns the
   * `staffProfileId` (not the user id) — that's what `/leave/balances/:staffProfileId` takes. */
  async function createStaffMember(joiningDate?: string): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const res = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Leave Type Staff ${suffix}`,
        username: `leavetype-staff-${suffix}`,
        email: `leavetype-staff-${suffix}@test.hayryou`,
        mobile: `+968${++mobileCounter}`,
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor: 100000,
        ...(joiningDate ? { joiningDate } : {}),
      })
      .expect(201);
    const profile = await db.staffProfile.findUniqueOrThrow({ where: { userId: res.body.id } });
    return profile.id;
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(AuthPrismaService);
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Leave Types Branch"))
      .expect(201);
    branchId = branch.body.id;

    const roles = await request().get("/api/v1/roles").set(auth(tenant.accessToken)).expect(200);
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates, lists, and updates a leave type", async () => {
    const nameEn = `Annual ${randomUUID().slice(0, 6)}`;
    const created = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn,
        nameAr: "سنوية",
        isPaid: true,
        daysPerYear: 30,
        countMode: "all_days",
        isEncashable: true,
        allowCarryForward: true,
        maxCarryForwardDays: 10,
      })
      .expect(201);
    expect(created.body.isActive).toBe(true);
    expect(created.body.daysPerYear).toBe(30);

    const list = await request()
      .get("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(list.body.map((t: { nameEn: string }) => t.nameEn)).toContain(nameEn);

    const updated = await request()
      .patch(`/api/v1/leave-types/${created.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ daysPerYear: 25, requiresSecondApproval: true })
      .expect(200);
    expect(updated.body.daysPerYear).toBe(25);
    expect(updated.body.requiresSecondApproval).toBe(true);

    // Deactivate (no hard delete) — disappears from the default list, still in includeInactive.
    await request()
      .patch(`/api/v1/leave-types/${created.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ isActive: false })
      .expect(200);

    const afterDeactivate = await request()
      .get("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(afterDeactivate.body.map((t: { id: string }) => t.id)).not.toContain(created.body.id);

    // Regression: the web app always sends an explicit includeInactive=false
    // (not just omitting the param) — a naive z.coerce.boolean() would treat
    // the non-empty string "false" as truthy and return inactive rows anyway.
    const explicitFalse = await request()
      .get("/api/v1/leave-types?includeInactive=false")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(explicitFalse.body.map((t: { id: string }) => t.id)).not.toContain(created.body.id);

    const withInactive = await request()
      .get("/api/v1/leave-types?includeInactive=true")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(withInactive.body.map((t: { id: string }) => t.id)).toContain(created.body.id);
  });

  it("rejects a maxCarryForwardDays set without allowCarryForward", async () => {
    const res = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Bad ${randomUUID().slice(0, 6)}`,
        nameAr: "خطأ",
        daysPerYear: 5,
        allowCarryForward: false,
        maxCarryForwardDays: 3,
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a duplicate name with NAME_EXISTS", async () => {
    const nameEn = `Sick ${randomUUID().slice(0, 6)}`;
    await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({ nameEn, nameAr: "مرضية", daysPerYear: 10 })
      .expect(201);

    const dup = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({ nameEn, nameAr: "مرضية", daysPerYear: 5 })
      .expect(409);
    expect(dup.body.code).toBe("NAME_EXISTS");
  });

  it("tenant B never sees tenant A's leave types", async () => {
    const nameEn = `Emergency ${randomUUID().slice(0, 6)}`;
    await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({ nameEn, nameAr: "طارئة", daysPerYear: 5 })
      .expect(201);

    const listB = await request()
      .get("/api/v1/leave-types")
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(listB.body.map((t: { nameEn: string }) => t.nameEn)).not.toContain(nameEn);
  });

  it("leave.request can list but leave.settings.manage is required to create/update", async () => {
    const branchManager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", []);

    await request().get("/api/v1/leave-types").set(auth(branchManager.accessToken)).expect(200);

    const denied = await request()
      .post("/api/v1/leave-types")
      .set(auth(branchManager.accessToken))
      .send({ nameEn: "X", nameAr: "س", daysPerYear: 1 })
      .expect(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
  });

  it("beginning_of_year: credits the full daysPerYear immediately on creation, not just on the next nightly accrual run", async () => {
    const eligibleStaffId = await createStaffMember("2026-01-01");
    const futureJoinerStaffId = await createStaffMember("2027-01-01");

    const created = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Beginning Of Year ${randomUUID().slice(0, 6)}`,
        nameAr: "بداية السنة",
        daysPerYear: 12,
        creditPolicy: "beginning_of_year",
      })
      .expect(201);

    const eligibleBalances = await request()
      .get(`/api/v1/leave/balances/${eligibleStaffId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const eligibleBalance = eligibleBalances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === created.body.id);
    expect(eligibleBalance.accrued).toBe(12);
    expect(eligibleBalance.closingBalance).toBe(12);

    // Joins next year — not yet eligible today, so creation must NOT have credited them.
    const futureBalances = await request()
      .get(`/api/v1/leave/balances/${futureJoinerStaffId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const futureBalance = futureBalances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === created.body.id);
    expect(futureBalance.accrued).toBe(0);
  });

  it("monthly: credits one month's slice (daysPerYear/12) immediately on creation", async () => {
    const staffId = await createStaffMember("2026-01-01");

    const created = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Monthly ${randomUUID().slice(0, 6)}`,
        nameAr: "شهرية",
        daysPerYear: 12,
        creditPolicy: "monthly",
      })
      .expect(201);

    const balances = await request()
      .get(`/api/v1/leave/balances/${staffId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const balance = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === created.body.id);
    expect(balance.accrued).toBe(1);
  });

  it("anniversary: credits the full daysPerYear immediately when this year's anniversary has already passed", async () => {
    // Joined Jan 1 — today (per the test environment's clock) is well past that anniversary date.
    const staffId = await createStaffMember("2026-01-01");

    const created = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Anniversary ${randomUUID().slice(0, 6)}`,
        nameAr: "سنوية الذكرى",
        daysPerYear: 12,
        creditPolicy: "anniversary",
      })
      .expect(201);

    const balances = await request()
      .get(`/api/v1/leave/balances/${staffId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const balance = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === created.body.id);
    expect(balance.accrued).toBe(12);
  });
});
