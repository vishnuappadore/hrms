import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createUserWithRole,
  provisionTenant,
  validBranchPayload,
  type TestTenant,
} from "./helpers";
import { AuthPrismaService } from "../src/database/auth-prisma.service";

describe("payroll", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantB: TestTenant;
  let db: AuthPrismaService;
  let branchAId: string;
  let branchBId: string;
  let managerRoleId: string;
  let allowanceComponentId: string;
  let deductionComponentId: string;
  let staffUserId: string;
  const payrollMonth = "2026-08";

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A fresh, empty branch — for tests that assert exact totals (branchAId accumulates permanently-eligible staff, no joiningDate/departure, across the whole file). */
  async function createIsolatedBranch(): Promise<string> {
    const res = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload(`Isolated Branch ${randomUUID().slice(0, 8)}`))
      .expect(201);
    return res.body.id as string;
  }

  /**
   * Marks every day of `(year, month)` (1-indexed) "present" for `staffProfileId`, via a plain
   * 09:00-17:00 session — neutralizes `absenceDeductionMinor` to exactly 0 for that month,
   * regardless of weekly-off configuration (a day with a real session never derives "absent").
   * Used to keep pre-existing, non-Attendance-aware payroll tests exact after absence deduction
   * started deriving real figures from Attendance for past months.
   */
  async function markFullyPresent(staffProfileId: string, year: number, month: number): Promise<void> {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      await request()
        .patch(`/api/v1/attendance/${staffProfileId}/days/${dateStr}`)
        .set(auth(tenant.accessToken))
        .send({ sessions: [{ checkInAt: `${dateStr}T09:00:00.000Z`, checkOutAt: `${dateStr}T17:00:00.000Z` }] })
        .expect(200);
    }
  }

  let mobileCounter = 90000000;
  async function createStaff(baseSalaryMinor: number, branchId: string = branchAId): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const res = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Staff ${suffix}`,
        username: `staff-${suffix}`,
        email: `staff-${suffix}@test.hayryou`,
        mobile: `+968${++mobileCounter}`,
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor,
      })
      .expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(AuthPrismaService);
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);

    const branchA = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Payroll Branch A"))
      .expect(201);
    branchAId = branchA.body.id;

    const branchB = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Payroll Branch B"))
      .expect(201);
    branchBId = branchB.body.id;

    const roles = await request().get("/api/v1/roles").set(auth(tenant.accessToken)).expect(200);
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;

    const allowance = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(tenant.accessToken))
      .send({ items: [{ nameEn: `Housing ${randomUUID().slice(0, 6)}`, nameAr: "سكن", basis: "fixed_amount", defaultAmountMinor: 50000 }] })
      .expect(200);
    allowanceComponentId = allowance.body[0].id;

    const deduction = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(tenant.accessToken))
      .send({ items: [{ nameEn: `PASI ${randomUUID().slice(0, 6)}`, nameAr: "التأمينات", basis: "fixed_amount", defaultAmountMinor: 20000 }] })
      .expect(200);
    deductionComponentId = deduction.body[0].id;

    const suffix = randomUUID().slice(0, 8);
    const staff = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Payroll Staff ${suffix}`,
        username: `payroll-staff-${suffix}`,
        email: `payroll-staff-${suffix}@test.hayryou`,
        mobile: "+96891234567",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchAId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchAId],
        baseSalaryMinor: 300000,
        allowances: [{ payrollComponentId: allowanceComponentId, amountMinor: 50000 }],
        deductions: [{ payrollComponentId: deductionComponentId, amountMinor: 20000 }],
      })
      .expect(201);
    staffUserId = staff.body.id;

    // staffUserId is reused by the two "2026-08" tests below with exact Net Pay assertions
    // predating Attendance — mark the whole month present so absenceDeductionMinor stays 0.
    const staffProfile = await db.staffProfile.findUniqueOrThrow({ where: { userId: staffUserId } });
    await markFullyPresent(staffProfile.id, 2026, 8);
  });

  afterAll(async () => {
    await app.close();
  });

  it("generates a run idempotently and computes Net Pay = base + allowances − statutory deductions", async () => {
    const first = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth })
      .expect(201);
    expect(first.body.branchId).toBe(branchAId);

    const second = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);

    const runId = first.body.id;
    const items = await request()
      .get(`/api/v1/payroll/runs/${runId}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId);
    expect(item).toBeDefined();
    expect(item.baseSalaryMinor).toBe(300000);
    expect(item.allowancesTotalMinor).toBe(50000);
    expect(item.statutoryDeductionsTotalMinor).toBe(20000);
    expect(item.netPayMinor).toBe(300000 + 50000 - 20000);
    expect(item.status).toBe("pending");
    expect(items.body.meta).toEqual({ page: 1, pageSize: 25, total: items.body.data.length });
  });

  it("edits ad-hoc additions/deductions, recomputes Net Pay, approves, batches, and locks after Mark Paid", async () => {
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId).id;

    const edited = await request()
      .patch(`/api/v1/payroll/items/${itemId}`)
      .set(auth(tenant.accessToken))
      .send({
        additions: [{ labelEn: "Overtime", amountMinor: 10000 }],
        extraDeductions: [{ labelEn: "Advance", amountMinor: 5000 }],
      })
      .expect(200);
    expect(edited.body.netPayMinor).toBe(300000 + 50000 + 10000 - 20000 - 5000);

    const approved = await request()
      .post(`/api/v1/payroll/items/${itemId}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.batchNo).toBe(1);

    const batches = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/batches?tab=approved`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(batches.body[0].batchNo).toBe(1);
    expect(batches.body[0].count).toBe(1);

    const paid = await request()
      .post(`/api/v1/payroll/items/${itemId}/mark-paid`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(paid.body.status).toBe("paid");

    const lockedEdit = await request()
      .patch(`/api/v1/payroll/items/${itemId}`)
      .set(auth(tenant.accessToken))
      .send({ otherDeductionMinor: 1000 })
      .expect(409);
    expect(lockedEdit.body.code).toBe("PAYROLL_ITEM_LOCKED");

    const lockedRevert = await request()
      .post(`/api/v1/payroll/items/${itemId}/revert`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(lockedRevert.body.code).toBe("PAYROLL_INVALID_TRANSITION");
  });

  it("rejects an item, allows revert back to Pending for correction", async () => {
    // No staff assigned to branch B — generating a run there is now blocked entirely (§D).
    const blocked = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchBId, payrollMonth: "2026-09" })
      .expect(409);
    expect(blocked.body.code).toBe("PAYROLL_NO_ELIGIBLE_EMPLOYEES");

    const runA = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2026-09" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${runA.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data[0].id;

    const rejected = await request()
      .post(`/api/v1/payroll/items/${itemId}/reject`)
      .set(auth(tenant.accessToken))
      .send({ reason: "Needs correction" })
      .expect(201);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.rejectionReason).toBe("Needs correction");

    const reverted = await request()
      .post(`/api/v1/payroll/items/${itemId}/revert`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(reverted.body.status).toBe("pending");
  });

  it("allows reverting an Approved item back to Pending (the bug that prompted the PAYROLL_ITEM_TRANSITIONS fix)", async () => {
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2027-02" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId).id;

    const approved = await request()
      .post(`/api/v1/payroll/items/${itemId}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(approved.body.status).toBe("approved");

    const reverted = await request()
      .post(`/api/v1/payroll/items/${itemId}/revert`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(reverted.body.status).toBe("pending");
    expect(reverted.body.batchNo).toBeNull();
  });

  it("syncs a newly-eligible staff member into an already-generated run without touching existing items", async () => {
    const syncMonth = "2026-12";
    const suffix = randomUUID().slice(0, 8);
    const secondStaff = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Sync Staff ${suffix}`,
        username: `sync-staff-${suffix}`,
        email: `sync-staff-${suffix}@test.hayryou`,
        mobile: "+96891234568",
        gender: "female",
        employmentType: "full_time",
        primaryBranchId: branchBId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchBId],
        baseSalaryMinor: 200000,
      })
      .expect(201);
    const secondStaffId = secondStaff.body.id;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: syncMonth })
      .expect(201);
    const runId = run.body.id;

    const beforeSync = await request()
      .get(`/api/v1/payroll/runs/${runId}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(beforeSync.body.data.map((i: { staff: { id: string } }) => i.staff.id)).not.toContain(secondStaffId);
    const originalItem = beforeSync.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId);
    expect(originalItem).toBeDefined();

    // Reassign the second staff member's Primary Branch to branch A AFTER the run already exists.
    await request()
      .patch(`/api/v1/users/${secondStaffId}`)
      .set(auth(tenant.accessToken))
      .send({ primaryBranchId: branchAId, branchIds: [branchAId] })
      .expect(200);

    const synced = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: syncMonth })
      .expect(201);
    expect(synced.body.id).toBe(runId);

    const afterSync = await request()
      .get(`/api/v1/payroll/runs/${runId}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const newItem = afterSync.body.data.find((i: { staff: { id: string } }) => i.staff.id === secondStaffId);
    expect(newItem).toBeDefined();
    expect(newItem.baseSalaryMinor).toBe(200000);
    expect(newItem.netPayMinor).toBe(200000);

    const unchangedItem = afterSync.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId);
    expect(unchangedItem).toEqual(originalItem);
  });

  it("previews a run before generating/syncing, and the preview's counts match what actually happens", async () => {
    const previewMonth = "2027-01";

    const before = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${previewMonth}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(before.body.runExists).toBe(false);
    expect(before.body.existingEmployeeCount).toBe(0);
    expect(before.body.totalEmployeeCount).toBe(before.body.newEmployeeCount);
    expect(before.body.statusCounts).toEqual({ pending: 0, approved: 0, rejected: 0, paid: 0 });
    const eligibleBeforeGenerate = before.body.newEmployeeCount;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: previewMonth })
      .expect(201);
    const runId = run.body.id;
    const itemsAfterGenerate = await request()
      .get(`/api/v1/payroll/runs/${runId}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(itemsAfterGenerate.body.data).toHaveLength(eligibleBeforeGenerate);

    const afterGenerate = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${previewMonth}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(afterGenerate.body.runExists).toBe(true);
    expect(afterGenerate.body.newEmployeeCount).toBe(0);
    expect(afterGenerate.body.existingEmployeeCount).toBe(eligibleBeforeGenerate);
    expect(afterGenerate.body.totalEmployeeCount).toBe(eligibleBeforeGenerate);
    expect(afterGenerate.body.statusCounts).toEqual({
      pending: eligibleBeforeGenerate,
      approved: 0,
      rejected: 0,
      paid: 0,
    });

    const suffix = randomUUID().slice(0, 8);
    await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Preview Staff ${suffix}`,
        username: `preview-staff-${suffix}`,
        email: `preview-staff-${suffix}@test.hayryou`,
        mobile: "+96891234569",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchAId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchAId],
        baseSalaryMinor: 150000,
      })
      .expect(201);

    const beforeSync = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${previewMonth}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(beforeSync.body.newEmployeeCount).toBe(1);
    expect(beforeSync.body.totalEmployeeCount).toBe(eligibleBeforeGenerate + 1);

    const anyItemId = itemsAfterGenerate.body.data[0].id;
    await request()
      .post(`/api/v1/payroll/items/${anyItemId}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    const beforeSyncWithApproval = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${previewMonth}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(beforeSyncWithApproval.body.statusCounts.approved).toBe(1);
    expect(beforeSyncWithApproval.body.statusCounts.pending).toBe(eligibleBeforeGenerate - 1);

    await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: previewMonth })
      .expect(201);

    const allTabs = await Promise.all(
      (["pending", "approved", "rejected"] as const).map((tab) =>
        request()
          .get(`/api/v1/payroll/runs/${runId}/items?tab=${tab}`)
          .set(auth(tenant.accessToken))
          .expect(200),
      ),
    );
    const totalItemsAfterSync = allTabs.reduce((sum, res) => sum + res.body.data.length, 0);
    expect(totalItemsAfterSync).toBe(eligibleBeforeGenerate + 1);
  });

  it("receptionist (no payroll.view) gets 403 previewing a run", async () => {
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchAId]);
    const res = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${payrollMonth}`)
      .set(auth(receptionist.accessToken))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("branch manager scoped to branch B gets 403 previewing branch A's run", async () => {
    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branchBId]);
    const res = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchAId}&payrollMonth=${payrollMonth}`)
      .set(auth(manager.accessToken))
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("receptionist (no payroll.generate) gets 403 generating a run", async () => {
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchAId]);
    const res = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(receptionist.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2026-10" })
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("branch manager scoped to branch B gets 403 reading branch A's run", async () => {
    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branchBId]);
    const res = await request()
      .get(`/api/v1/payroll/runs?branchId=${branchAId}&payrollMonth=${payrollMonth}`)
      .set(auth(manager.accessToken))
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("prorates base salary, allowances, and statutory deductions for a mid-month joiner, and reports paidDays", async () => {
    const suffix = randomUUID().slice(0, 8);
    // 2027-03 has 31 days; joining on the 21st pays for days 21..31 = 11 days.
    const midMonthStaff = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `MidMonth Staff ${suffix}`,
        username: `midmonth-staff-${suffix}`,
        email: `midmonth-staff-${suffix}@test.hayryou`,
        mobile: "+96891234570",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchAId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchAId],
        baseSalaryMinor: 310000,
        allowances: [{ payrollComponentId: allowanceComponentId, amountMinor: 50000 }],
        deductions: [{ payrollComponentId: deductionComponentId, amountMinor: 20000 }],
        joiningDate: "2027-03-21",
      })
      .expect(201);
    const midMonthStaffId = midMonthStaff.body.id;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2027-03" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === midMonthStaffId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(11);
    expect(item.totalDaysInMonth).toBe(31);
    // base 310000 * 11/31 = 110000 exactly; allowance 50000 * 11/31 = 17741.9... -> half-up 17742;
    // deduction 20000 * 11/31 = 7096.7... -> half-up 7097.
    expect(item.baseSalaryMinor).toBe(110000);
    expect(item.allowancesTotalMinor).toBe(17742);
    expect(item.statutoryDeductionsTotalMinor).toBe(7097);
    expect(item.netPayMinor).toBe(110000 + 17742 - 7097);
  });

  it("pays a full unprorated month for staff who joined before the payroll month (or have no Date of Join)", async () => {
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2027-04" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(item.totalDaysInMonth);
    expect(item.baseSalaryMinor).toBe(300000);
    expect(item.netPayMinor).toBe(300000 + 50000 - 20000);
  });

  it("excludes staff who join after the payroll month ends from every tab, and previewRun's newEmployeeCount respects it", async () => {
    const excludeMonth = "2027-05";
    const suffix = randomUUID().slice(0, 8);
    const futureStaff = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Future Staff ${suffix}`,
        username: `future-staff-${suffix}`,
        email: `future-staff-${suffix}@test.hayryou`,
        mobile: "+96891234571",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchBId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchBId],
        baseSalaryMinor: 250000,
        joiningDate: "2027-06-01",
      })
      .expect(201);
    const futureStaffId = futureStaff.body.id;

    const preview = await request()
      .get(`/api/v1/payroll/runs/preview?branchId=${branchBId}&payrollMonth=${excludeMonth}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(preview.body.newEmployeeCount).toBe(0);
    expect(preview.body.totalEmployeeCount).toBe(0);

    const blocked = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchBId, payrollMonth: excludeMonth })
      .expect(409);
    expect(blocked.body.code).toBe("PAYROLL_NO_ELIGIBLE_EMPLOYEES");

    // Add an eligible staff member alongside the not-yet-joined one so the run can be generated,
    // then confirm the future joiner is absent from every tab.
    const eligibleSuffix = randomUUID().slice(0, 8);
    await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Eligible Staff ${eligibleSuffix}`,
        username: `eligible-staff-${eligibleSuffix}`,
        email: `eligible-staff-${eligibleSuffix}@test.hayryou`,
        mobile: "+96891234572",
        gender: "female",
        employmentType: "full_time",
        primaryBranchId: branchBId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchBId],
        baseSalaryMinor: 220000,
      })
      .expect(201);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchBId, payrollMonth: excludeMonth })
      .expect(201);

    const allTabs = await Promise.all(
      (["pending", "approved", "rejected"] as const).map((tab) =>
        request()
          .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=${tab}`)
          .set(auth(tenant.accessToken))
          .expect(200),
      ),
    );
    const allStaffIds = allTabs.flatMap((res) => res.body.data.map((i: { staff: { id: string } }) => i.staff.id));
    expect(allStaffIds).not.toContain(futureStaffId);
  });

  it("pays exactly 1 day when joining on the last day of the payroll month", async () => {
    const suffix = randomUUID().slice(0, 8);
    // 2027-07 has 31 days; joining on the 31st pays for 1 day.
    const lastDayStaff = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `LastDay Staff ${suffix}`,
        username: `lastday-staff-${suffix}`,
        email: `lastday-staff-${suffix}@test.hayryou`,
        mobile: "+96891234573",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchAId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchAId],
        baseSalaryMinor: 310000,
        joiningDate: "2027-07-31",
      })
      .expect(201);
    const lastDayStaffId = lastDayStaff.body.id;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2027-07" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === lastDayStaffId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(1);
    expect(item.baseSalaryMinor).toBe(10000);
  });

  it("bulk mark-paid moves multiple Approved items to Paid, and bulk revert reopens Approved/Rejected items to Pending", async () => {
    const bulkMonth = "2027-08";
    const suffixes = [randomUUID().slice(0, 8), randomUUID().slice(0, 8)];
    const bulkStaffIds: string[] = [];
    for (const [i, suffix] of suffixes.entries()) {
      const created = await request()
        .post("/api/v1/users")
        .set(auth(tenant.accessToken))
        .send({
          name: `Bulk Staff ${suffix}`,
          username: `bulk-staff-${suffix}`,
          email: `bulk-staff-${suffix}@test.hayryou`,
          mobile: `+9689123458${i}`,
          gender: "male",
          employmentType: "full_time",
          primaryBranchId: branchAId,
          password: "Staff@12345",
          roleId: managerRoleId,
          branchIds: [branchAId],
          baseSalaryMinor: 200000,
        })
        .expect(201);
      bulkStaffIds.push(created.body.id);
    }

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: bulkMonth })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const bulkItemIds = bulkStaffIds.map(
      (id) => items.body.data.find((i: { staff: { id: string } }) => i.staff.id === id).id,
    );

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-approve`)
      .set(auth(tenant.accessToken))
      .send({ itemIds: bulkItemIds })
      .expect(201);
    for (const id of bulkItemIds) {
      const detail = await request().get(`/api/v1/payroll/items/${id}`).set(auth(tenant.accessToken)).expect(200);
      expect(detail.body.status).toBe("approved");
    }

    const [toMarkPaid, toRevert] = bulkItemIds;

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-mark-paid`)
      .set(auth(tenant.accessToken))
      .send({ itemIds: [toMarkPaid] })
      .expect(201);
    const paidDetail = await request()
      .get(`/api/v1/payroll/items/${toMarkPaid}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(paidDetail.body.status).toBe("paid");

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-revert`)
      .set(auth(tenant.accessToken))
      .send({ itemIds: [toRevert] })
      .expect(201);
    const revertedDetail = await request()
      .get(`/api/v1/payroll/items/${toRevert}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(revertedDetail.body.status).toBe("pending");
    expect(revertedDetail.body.batchNo).toBeNull();

    // Bulk revert also works from the Rejected tab.
    await request()
      .post(`/api/v1/payroll/items/${toRevert}/reject`)
      .set(auth(tenant.accessToken))
      .send({ reason: "Needs correction" })
      .expect(201);

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-revert`)
      .set(auth(tenant.accessToken))
      .send({ itemIds: [toRevert] })
      .expect(201);
    const revertedFromRejectedDetail = await request()
      .get(`/api/v1/payroll/items/${toRevert}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(revertedFromRejectedDetail.body.status).toBe("pending");
  });

  it("paginates listItems — meta.total is correct and pages don't overlap", async () => {
    const month = "2027-09";
    const isolatedBranchId = await createIsolatedBranch();
    const idA = await createStaff(100000, isolatedBranchId);
    const idB = await createStaff(200000, isolatedBranchId);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: month })
      .expect(201);

    const page1 = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending&page=1&pageSize=1`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(page1.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(page1.body.data).toHaveLength(1);

    const page2 = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending&page=2&pageSize=1`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(page2.body.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);

    const staffIdsSeen = [page1.body.data[0], page2.body.data[0]].map((i: { staff: { id: string } }) => i.staff.id);
    expect(staffIdsSeen.sort()).toEqual([idA, idB].sort());
  });

  it("listBatches returns lightweight menu entries (no nested items) with correct count/totalNetMinor; listBatchItems paginates one batch's items and 404s for a batch outside the run", async () => {
    const month = "2027-10";
    const idA = await createStaff(100000);
    const idB = await createStaff(150000);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: month })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemIds = [idA, idB].map(
      (staffId) => items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffId).id,
    );

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-approve`)
      .set(auth(tenant.accessToken))
      .send({ itemIds })
      .expect(201);

    const batches = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/batches?tab=approved`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const batch = batches.body[0];
    expect(batch.items).toBeUndefined();
    expect(batch.count).toBe(2);
    expect(batch.totalNetMinor).toBe(100000 + 150000);

    const batchItemsPage1 = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/batches/${batch.id}/items?page=1&pageSize=1`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(batchItemsPage1.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(batchItemsPage1.body.data).toHaveLength(1);

    const batchItemsPage2 = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/batches/${batch.id}/items?page=2&pageSize=1`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(batchItemsPage2.body.data[0].id).not.toBe(batchItemsPage1.body.data[0].id);

    // A real batch id, but requested against a different run — must 404, not leak across runs.
    const otherRun = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2027-11" })
      .expect(201);
    await request()
      .get(`/api/v1/payroll/runs/${otherRun.body.id}/batches/${batch.id}/items`)
      .set(auth(tenant.accessToken))
      .expect(404);
  });

  it("bulk selectAll from the Approved tab only touches Approved items, never sweeping in already-Paid ones", async () => {
    const month = "2027-12";
    const idA = await createStaff(100000);
    const idB = await createStaff(150000);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: month })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemIdA = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === idA).id;
    const itemIdB = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === idB).id;

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-approve`)
      .set(auth(tenant.accessToken))
      .send({ itemIds: [itemIdA, itemIdB] })
      .expect(201);

    // A is marked paid individually — B stays merely Approved. The Approved
    // tab now displays BOTH (paid renders inside the Approved tab).
    await request()
      .post(`/api/v1/payroll/items/${itemIdA}/mark-paid`)
      .set(auth(tenant.accessToken))
      .expect(201);

    // selectAll from the Approved tab, no exclusions — must resolve to just B (still `approved`),
    // NOT re-touch A (already `paid`, a terminal status).
    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-mark-paid`)
      .set(auth(tenant.accessToken))
      .send({ selectAll: { tab: "approved" } })
      .expect(201);

    const detailA = await request().get(`/api/v1/payroll/items/${itemIdA}`).set(auth(tenant.accessToken)).expect(200);
    const detailB = await request().get(`/api/v1/payroll/items/${itemIdB}`).set(auth(tenant.accessToken)).expect(200);
    expect(detailA.body.status).toBe("paid");
    expect(detailB.body.status).toBe("paid");
  });

  it("bulk selectAll approve honors excludeIds", async () => {
    const month = "2028-01";
    const isolatedBranchId = await createIsolatedBranch();
    const idA = await createStaff(100000, isolatedBranchId);
    const idB = await createStaff(150000, isolatedBranchId);
    const idC = await createStaff(120000, isolatedBranchId);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: month })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemIdC = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === idC).id;

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-approve`)
      .set(auth(tenant.accessToken))
      .send({ selectAll: { tab: "pending", excludeIds: [itemIdC] } })
      .expect(201);

    const afterA = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=approved`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(afterA.body.data.map((i: { staff: { id: string } }) => i.staff.id).sort()).toEqual([idA, idB].sort());

    const afterPending = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(afterPending.body.data.map((i: { staff: { id: string } }) => i.staff.id)).toEqual([idC]);
  });

  it("tenant B cannot read tenant A's payroll item", async () => {
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: branchAId, payrollMonth: "2026-11" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data[0].id;

    await request()
      .get(`/api/v1/payroll/items/${itemId}`)
      .set(auth(tenantB.accessToken))
      .expect(404);
  });

  /** Creates a staff member and logs them in — for the Absence/Unpaid-leave tests below, which need
   * the staff's own token (to submit a leave request) and `staffProfileId` (to mark attendance). */
  async function createStaffMember(
    baseSalaryMinor: number,
    branchId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ userId: string; staffProfileId: string; accessToken: string }> {
    const suffix = randomUUID().slice(0, 8);
    const username = `absence-staff-${suffix}`;
    const password = "Staff@12345";
    const res = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name: `Absence Staff ${suffix}`,
        username,
        email: `${username}@test.hayryou`,
        mobile: `+968${++mobileCounter}`,
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password,
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor,
        ...overrides,
      })
      .expect(201);
    const userId = res.body.id as string;
    const profile = await db.staffProfile.findUniqueOrThrow({ where: { userId } });
    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: username, password })
      .expect(200);
    return { userId, staffProfileId: profile.id, accessToken: login.body.tokens.accessToken as string };
  }

  async function markPresent(staffProfileId: string, dateStr: string): Promise<void> {
    await request()
      .patch(`/api/v1/attendance/${staffProfileId}/days/${dateStr}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: `${dateStr}T09:00:00.000Z`, checkOutAt: `${dateStr}T17:00:00.000Z` }] })
      .expect(200);
  }

  it("computes an Absence Deduction from genuine absent (no-attendance-row) days, reducing Net Pay", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(300000, isolatedBranchId);

    // June 2026 (30 days) is fully in the past. Mark every day present except two chosen
    // Wednesdays — those two stay "absent" (no attendance row, not weekly-off, in the past).
    for (let day = 1; day <= 30; day++) {
      if (day === 10 || day === 17) continue;
      await markPresent(staff.staffProfileId, `2026-06-${String(day).padStart(2, "0")}`);
    }

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2026-06" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(30);
    expect(item.totalDaysInMonth).toBe(30);
    // absentDays = 2; 300000 * 2/30 = 20000 exactly.
    expect(item.absenceDeductionMinor).toBe(20000);
    expect(item.netPayMinor).toBe(300000 - 20000);
  });

  it("excludes days before joiningDate from the absence count", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    // June 2026 has 30 days; joining on the 20th pays for days 20..30 = 11 days.
    const staff = await createStaffMember(330000, isolatedBranchId, { joiningDate: "2026-06-20" });

    // Mark every day from joining to month-end present. Days 1..19 (before joining) are left with
    // no attendance row at all — if the join-date clamp were missing, those would wrongly count as
    // absent too.
    for (let day = 20; day <= 30; day++) {
      await markPresent(staff.staffProfileId, `2026-06-${String(day).padStart(2, "0")}`);
    }

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2026-06" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(11);
    expect(item.absenceDeductionMinor).toBe(0);
    expect(item.baseSalaryMinor).toBe(121000); // 330000 * 11/30
    expect(item.netPayMinor).toBe(121000);
  });

  it("an approved UNPAID-leave-type request creates a Leave Deduction on Gross — paidDays/Base/Allowances stay whole", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(290000, isolatedBranchId, {
      allowances: [{ payrollComponentId: allowanceComponentId, amountMinor: 29000 }],
    });

    const leaveType = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Unpaid Leave ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة بدون راتب",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
        isPaid: false,
      })
      .expect(201);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId: leaveType.body.id, startDate: "2028-02-10", endDate: "2028-02-12", reason: "Unpaid" })
      .expect(201);
    expect(created.body.daysCount).toBe(3);
    await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    // Feb 2028 is a leap year — 29 days. Gross = 290000 + 29000 = 319000;
    // leaveDeductionMinor = 319000 * 3/29 = 33000 exactly.
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-02" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item).toBeDefined();
    expect(item.totalDaysInMonth).toBe(29);
    expect(item.paidDays).toBe(29); // unaffected — unpaid leave no longer reduces paidDays
    expect(item.baseSalaryMinor).toBe(290000); // full, unprorated
    expect(item.allowancesTotalMinor).toBe(29000); // full, unprorated
    expect(item.absenceDeductionMinor).toBe(0);
    expect(item.unpaidLeaveDays).toBe(3);
    expect(item.leaveDeductionMinor).toBe(33000); // Gross(319000) * 3/29
    expect(item.netPayMinor).toBe(290000 + 29000 - 33000);
  });

  it("an approved PAID-leave-type request has no effect on paidDays, absenceDeductionMinor, or leaveDeductionMinor", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(150000, isolatedBranchId);

    const leaveType = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Paid Leave ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة مدفوعة",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
      })
      .expect(201);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId: leaveType.body.id, startDate: "2028-03-05", endDate: "2028-03-06", reason: "Vacation" })
      .expect(201);
    await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-03" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item).toBeDefined();
    expect(item.paidDays).toBe(item.totalDaysInMonth);
    expect(item.absenceDeductionMinor).toBe(0);
    expect(item.unpaidLeaveDays).toBe(0);
    expect(item.leaveDeductionMinor).toBe(0);
    expect(item.netPayMinor).toBe(150000);
  });

  it("Absence Deduction is computed on Gross (base + allowances), not just Base", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(200000, isolatedBranchId, {
      allowances: [{ payrollComponentId: allowanceComponentId, amountMinor: 100000 }],
    });

    // June 2026 (30 days) is fully in the past. Mark every day present except one, which stays
    // "absent". Gross = 200000 + 100000 = 300000; absenceDeductionMinor = 300000 * 1/30 = 10000 —
    // a Base-only calc would have given 200000/30 = 6666.67 instead, so this also proves the fix.
    for (let day = 1; day <= 30; day++) {
      if (day === 15) continue;
      await markPresent(staff.staffProfileId, `2026-06-${String(day).padStart(2, "0")}`);
    }

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2026-06" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item.absentDays).toBe(1);
    expect(item.absenceDeductionMinor).toBe(10000);
    expect(item.baseSalaryMinor).toBe(200000);
    expect(item.allowancesTotalMinor).toBe(100000);
    expect(item.netPayMinor).toBe(200000 + 100000 - 10000);
  });

  it("editing a payslip can override absenceDeductionMinor/leaveDeductionMinor, and Net Pay recomputes correctly", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(300000, isolatedBranchId);

    for (let day = 1; day <= 30; day++) {
      if (day === 10) continue;
      await markPresent(staff.staffProfileId, `2026-06-${String(day).padStart(2, "0")}`);
    }

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2026-06" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    expect(item.absenceDeductionMinor).toBe(10000); // 300000 * 1/30
    expect(item.leaveDeductionMinor).toBe(0);

    const edited = await request()
      .patch(`/api/v1/payroll/items/${item.id}`)
      .set(auth(tenant.accessToken))
      .send({ absenceDeductionMinor: 5000, leaveDeductionMinor: 3000 })
      .expect(200);
    expect(edited.body.absenceDeductionMinor).toBe(5000);
    expect(edited.body.leaveDeductionMinor).toBe(3000);
    expect(edited.body.netPayMinor).toBe(300000 - 5000 - 3000);
  });

  it("recompute picks up unpaid leave approved AFTER the item was already generated, creating the Leave Deduction", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(290000, isolatedBranchId, {
      allowances: [{ payrollComponentId: allowanceComponentId, amountMinor: 29000 }],
    });

    // Generate the run FIRST — item snapshotted with no leave yet (Gross = 319000, no deduction).
    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-02" })
      .expect(201);
    const itemsBefore = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemBefore = itemsBefore.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId);
    const itemId = itemBefore.id;
    expect(itemBefore.paidDays).toBe(29);
    expect(itemBefore.leaveDeductionMinor).toBe(0);
    expect(itemBefore.netPayMinor).toBe(290000 + 29000);

    // THEN the staff applies and gets approved for 3 days of unpaid leave in that same month.
    const leaveType = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Unpaid Leave ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة بدون راتب",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
        isPaid: false,
      })
      .expect(201);
    const leaveRequest = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId: leaveType.body.id, startDate: "2028-02-10", endDate: "2028-02-12", reason: "Unpaid" })
      .expect(201);
    await request()
      .post(`/api/v1/leave/requests/${leaveRequest.body.id}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    // Without recompute, the item is still stale — confirm it, then recompute.
    const stillStale = await request().get(`/api/v1/payroll/items/${itemId}`).set(auth(tenant.accessToken)).expect(200);
    expect(stillStale.body.leaveDeductionMinor).toBe(0);
    expect(stillStale.body.netPayMinor).toBe(290000 + 29000);

    // Gross(319000) * 3/29 = 33000 exactly.
    const recomputed = await request()
      .post(`/api/v1/payroll/items/${itemId}/recompute`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(recomputed.body.paidDays).toBe(29); // unaffected — join-date only
    expect(recomputed.body.baseSalaryMinor).toBe(290000); // unaffected — full
    expect(recomputed.body.allowancesTotalMinor).toBe(29000); // unaffected — full
    expect(recomputed.body.unpaidLeaveDays).toBe(3);
    expect(recomputed.body.leaveDeductionMinor).toBe(33000);
    expect(recomputed.body.netPayMinor).toBe(290000 + 29000 - 33000);
  });

  it("rejects recompute on a non-Pending item with PAYROLL_ITEM_LOCKED", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    await createStaff(200000, isolatedBranchId);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-05" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data[0].id;

    await request().post(`/api/v1/payroll/items/${itemId}/approve`).set(auth(tenant.accessToken)).expect(201);

    const res = await request()
      .post(`/api/v1/payroll/items/${itemId}/recompute`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(res.body.code).toBe("PAYROLL_ITEM_LOCKED");
  });

  it("recompute refreshes system-computed figures without touching manual overrides", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staff = await createStaffMember(300000, isolatedBranchId);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-04" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemId = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staff.userId).id;

    // Manual overrides, applied BEFORE the unpaid leave exists.
    const edited = await request()
      .patch(`/api/v1/payroll/items/${itemId}`)
      .set(auth(tenant.accessToken))
      .send({ otherDeductionMinor: 2000, extraDeductions: [{ labelEn: "Advance", amountMinor: 1000 }] })
      .expect(200);
    expect(edited.body.netPayMinor).toBe(300000 - 2000 - 1000);

    const leaveType = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Unpaid Leave ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة بدون راتب",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
        isPaid: false,
      })
      .expect(201);
    const leaveRequest = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId: leaveType.body.id, startDate: "2028-04-10", endDate: "2028-04-11", reason: "Unpaid" })
      .expect(201);
    await request()
      .post(`/api/v1/leave/requests/${leaveRequest.body.id}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    const recomputed = await request()
      .post(`/api/v1/payroll/items/${itemId}/recompute`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(recomputed.body.paidDays).toBe(30); // unaffected — unpaid leave no longer reduces paidDays
    expect(recomputed.body.baseSalaryMinor).toBe(300000); // unaffected — full, unprorated
    expect(recomputed.body.unpaidLeaveDays).toBe(2);
    expect(recomputed.body.leaveDeductionMinor).toBe(20000); // Gross(300000, no allowances) * 2/30
    expect(recomputed.body.otherDeductionMinor).toBe(2000); // untouched manual override
    expect(recomputed.body.extraDeductionsTotalMinor).toBe(1000); // untouched ad-hoc row
    expect(recomputed.body.netPayMinor).toBe(300000 - 2000 - 20000 - 1000);
  });

  it("bulk-recompute refreshes several Pending items in one run via selectAll", async () => {
    const isolatedBranchId = await createIsolatedBranch();
    const staffA = await createStaffMember(300000, isolatedBranchId);
    const staffB = await createStaffMember(150000, isolatedBranchId);

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenant.accessToken))
      .send({ branchId: isolatedBranchId, payrollMonth: "2028-06" })
      .expect(201);

    // Only staffA gets approved unpaid leave — staffB stays untouched throughout.
    const leaveType = await request()
      .post("/api/v1/leave-types")
      .set(auth(tenant.accessToken))
      .send({
        nameEn: `Unpaid Leave ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة بدون راتب",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
        isPaid: false,
      })
      .expect(201);
    const leaveRequest = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staffA.accessToken))
      .send({ leaveTypeId: leaveType.body.id, startDate: "2028-06-10", endDate: "2028-06-11", reason: "Unpaid" })
      .expect(201);
    await request()
      .post(`/api/v1/leave/requests/${leaveRequest.body.id}/approve`)
      .set(auth(tenant.accessToken))
      .expect(201);

    await request()
      .post(`/api/v1/payroll/runs/${run.body.id}/bulk-recompute`)
      .set(auth(tenant.accessToken))
      .send({ selectAll: { tab: "pending", excludeIds: [] } })
      .expect(201);

    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const itemA = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffA.userId);
    const itemB = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffB.userId);

    expect(itemA.unpaidLeaveDays).toBe(2);
    expect(itemA.leaveDeductionMinor).toBe(20000); // 300000 * 2/30
    expect(itemA.paidDays).toBe(30);
    expect(itemB.leaveDeductionMinor).toBe(0);
    expect(itemB.netPayMinor).toBe(150000);
  });

  it("a percentage-basis payroll component is computed live from base salary, not the stale stored snapshot", async () => {
    // Isolated under tenantB — the fixed_amount allowance/deduction catalog under `tenant` is
    // shared across this whole file via a full-replace PUT, so a separate tenant avoids touching it.
    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenantB.accessToken))
      .send(validBranchPayload("Percentage Component Branch"))
      .expect(201);
    const branchId = branch.body.id;
    const roles = await request().get("/api/v1/roles").set(auth(tenantB.accessToken)).expect(200);
    const managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;

    const allowance = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(tenantB.accessToken))
      .send({
        items: [{ nameEn: `Transport ${randomUUID().slice(0, 6)}`, nameAr: "مواصلات", basis: "percentage_of_base", defaultRatePct: 10 }],
      })
      .expect(200);
    const deduction = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(tenantB.accessToken))
      .send({
        items: [{ nameEn: `ESI ${randomUUID().slice(0, 6)}`, nameAr: "التأمينات", basis: "percentage_of_base", defaultRatePct: 12 }],
      })
      .expect(200);

    const suffix = randomUUID().slice(0, 8);
    const staff = await request()
      .post("/api/v1/users")
      .set(auth(tenantB.accessToken))
      .send({
        name: `Percentage Staff ${suffix}`,
        username: `pct-staff-${suffix}`,
        email: `pct-staff-${suffix}@test.hayryou`,
        mobile: "+96891111111",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor: 300000,
        // Deliberately wrong stored amounts — a stale client-side snapshot from before a base
        // salary change — to prove the server recomputes live rather than trusting these.
        allowances: [{ payrollComponentId: allowance.body[0].id, amountMinor: 999 }],
        deductions: [{ payrollComponentId: deduction.body[0].id, amountMinor: 999 }],
      })
      .expect(201);
    const staffUserId = staff.body.id;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenantB.accessToken))
      .send({ branchId, payrollMonth: "2028-07" })
      .expect(201);
    const items = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenantB.accessToken))
      .expect(200);
    const item = items.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId);
    expect(item).toBeDefined();
    expect(item.allowancesTotalMinor).toBe(30000); // 300000 * 10%, not the stored 999
    expect(item.statutoryDeductionsTotalMinor).toBe(36000); // 300000 * 12%, not the stored 999
    expect(item.netPayMinor).toBe(300000 + 30000 - 36000);
  });

  it("recompute updates a percentage-basis component after the staff member's base salary changes", async () => {
    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenantB.accessToken))
      .send(validBranchPayload("Percentage Recompute Branch"))
      .expect(201);
    const branchId = branch.body.id;
    const roles = await request().get("/api/v1/roles").set(auth(tenantB.accessToken)).expect(200);
    const managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;

    const deduction = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(tenantB.accessToken))
      .send({
        items: [{ nameEn: `ESI ${randomUUID().slice(0, 6)}`, nameAr: "التأمينات", basis: "percentage_of_base", defaultRatePct: 12 }],
      })
      .expect(200);

    const suffix = randomUUID().slice(0, 8);
    const staff = await request()
      .post("/api/v1/users")
      .set(auth(tenantB.accessToken))
      .send({
        name: `Recompute Percentage Staff ${suffix}`,
        username: `pct-recompute-${suffix}`,
        email: `pct-recompute-${suffix}@test.hayryou`,
        mobile: "+96891111112",
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: branchId,
        password: "Staff@12345",
        roleId: managerRoleId,
        branchIds: [branchId],
        baseSalaryMinor: 200000,
        deductions: [{ payrollComponentId: deduction.body[0].id, amountMinor: 24000 }],
      })
      .expect(201);
    const staffUserId = staff.body.id;

    const run = await request()
      .post("/api/v1/payroll/runs")
      .set(auth(tenantB.accessToken))
      .send({ branchId, payrollMonth: "2028-08" })
      .expect(201);
    const itemsBefore = await request()
      .get(`/api/v1/payroll/runs/${run.body.id}/items?tab=pending`)
      .set(auth(tenantB.accessToken))
      .expect(200);
    const itemId = itemsBefore.body.data.find((i: { staff: { id: string } }) => i.staff.id === staffUserId).id;
    expect(itemsBefore.body.data.find((i: { id: string }) => i.id === itemId).statutoryDeductionsTotalMinor).toBe(24000); // 200000 * 12%

    await request()
      .patch(`/api/v1/users/${staffUserId}`)
      .set(auth(tenantB.accessToken))
      .send({ baseSalaryMinor: 500000 })
      .expect(200);

    const recomputed = await request()
      .post(`/api/v1/payroll/items/${itemId}/recompute`)
      .set(auth(tenantB.accessToken))
      .expect(201);
    expect(recomputed.body.baseSalaryMinor).toBe(500000);
    expect(recomputed.body.statutoryDeductionsTotalMinor).toBe(60000); // 500000 * 12%, reflecting the NEW salary
  });
});
