import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, createUserWithRole, validBranchPayload, type TestAdmin } from "./helpers";
import { PrismaService } from "../src/database/prisma.service";

describe("leave", () => {
  let app: INestApplication;
  let admin: TestAdmin;
  let db: PrismaService;
  let branchId: string;
  let managerRoleId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let mobileCounter = 90000000;

  /** Creates a staff member (Branch Manager role — has leave.request/view/approve) and logs them in. */
  async function createStaffMember(
    name: string,
    opts: { branchId?: string } = {},
  ): Promise<{ userId: string; staffProfileId: string; accessToken: string }> {
    const suffix = randomUUID().slice(0, 8);
    const username = `leave-staff-${suffix}`;
    const password = "Staff@12345";
    const res = await request()
      .post("/api/v1/employees")
      .set(auth(admin.accessToken))
      .send({
        name,
        username,
        email: `${username}@test.keystonehr`,
        mobile: `+971${++mobileCounter}`,
        gender: "male",
        employmentType: "full_time",
        primaryBranchId: opts.branchId ?? branchId,
        password,
        roleId: managerRoleId,
        branchIds: [opts.branchId ?? branchId],
        baseSalaryMinor: 100000,
      })
      .expect(201);
    const userId = res.body.id as string;
    const profile = await db.client.employeeProfile.findUniqueOrThrow({ where: { userId } });
    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: username, password })
      .expect(200);
    return { userId, staffProfileId: profile.id, accessToken: login.body.tokens.accessToken as string };
  }

  async function createLeaveType(overrides: Record<string, unknown> = {}): Promise<string> {
    const res = await request()
      .post("/api/v1/leave-types")
      .set(auth(admin.accessToken))
      .send({
        nameEn: `Leave Type ${randomUUID().slice(0, 6)}`,
        nameAr: "إجازة",
        daysPerYear: 20,
        countMode: "all_days",
        allowNegativeBalance: true,
        ...overrides,
      })
      .expect(201);
    return res.body.id as string;
  }

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** A date range far enough out to clear any minimumNoticeDays used in these tests. */
  function futureRange(startOffsetDays: number, lengthDays: number): { startDate: string; endDate: string } {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() + startOffsetDays);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + lengthDays - 1);
    return { startDate: isoDate(start), endDate: isoDate(end) };
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    admin = await createTestAdmin(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(admin.accessToken))
      .send(validBranchPayload("Leave Branch"))
      .expect(201);
    branchId = branch.body.id;

    const roles = await request().get("/api/v1/roles").set(auth(admin.accessToken)).expect(200);
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("self-service request → approve: computes days, deducts balance, marks attendance on_leave", async () => {
    const staff = await createStaffMember("Approved Staff");
    const leaveTypeId = await createLeaveType({ daysPerYear: 20 });
    const { startDate, endDate } = futureRange(5, 3);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Vacation" })
      .expect(201);
    expect(created.body.status).toBe("pending");
    expect(created.body.daysCount).toBe(3);

    const approved = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(201);
    expect(approved.body.status).toBe("approved");

    const balances = await request()
      .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const balance = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(balance.used).toBe(3);

    const midDate = startDate; // first day of the approved range
    const day = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${midDate}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(day.body.status).toBe("on_leave");
  });

  it("reject: no balance or attendance side effects", async () => {
    const staff = await createStaffMember("Rejected Staff");
    const leaveTypeId = await createLeaveType();
    const { startDate, endDate } = futureRange(5, 2);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(201);

    const rejected = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/reject`)
      .set(auth(admin.accessToken))
      .send({ rejectionReason: "Short-staffed that week" })
      .expect(201);
    expect(rejected.body.status).toBe("rejected");

    const balances = await request()
      .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    const balance = balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId);
    expect(balance.used).toBe(0);

    const day = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${startDate}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(day.body.status).not.toBe("on_leave");
  });

  it("rejects a request made inside the leave type's minimum notice window", async () => {
    const staff = await createStaffMember("Late Notice Staff");
    const leaveTypeId = await createLeaveType({ minimumNoticeDays: 30 });
    const { startDate, endDate } = futureRange(1, 1);

    const res = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(400);
    expect(res.body.code).toBe("LEAVE_MINIMUM_NOTICE_NOT_MET");
  });

  it("rejects a half-day request when the leave type doesn't allow it", async () => {
    const staff = await createStaffMember("Half Day Staff");
    const leaveTypeId = await createLeaveType({ allowHalfDay: false });
    const { startDate, endDate } = futureRange(5, 1);

    const res = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
      .expect(400);
    expect(res.body.code).toBe("LEAVE_HALF_DAY_NOT_ALLOWED");
  });

  it("rejects a request missing a required supporting document", async () => {
    const staff = await createStaffMember("Document Staff");
    const leaveTypeId = await createLeaveType({ requireSupportingDocument: true });
    const { startDate, endDate } = futureRange(5, 1);

    const res = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(400);
    expect(res.body.code).toBe("LEAVE_SUPPORTING_DOCUMENT_REQUIRED");
  });

  it("rejects an over-balance request when the leave type disallows negative balance", async () => {
    const staff = await createStaffMember("No Balance Staff");
    const leaveTypeId = await createLeaveType({ allowNegativeBalance: false });
    // Longer than daysPerYear (20) so the request exceeds the balance regardless of how much a
    // new leave type's eager creation-time accrual (LeaveTypesService.create) already credited.
    const { startDate, endDate } = futureRange(5, 25);

    const res = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(400);
    expect(res.body.code).toBe("LEAVE_INSUFFICIENT_BALANCE");
  });

  it("requiresSecondApproval: first approve moves to pending_second_approval with no side effects, second approve finalizes", async () => {
    const staff = await createStaffMember("Two Step Staff");
    const leaveTypeId = await createLeaveType({ requiresSecondApproval: true });
    const { startDate, endDate } = futureRange(5, 2);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(201);

    const firstApprove = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(201);
    expect(firstApprove.body.status).toBe("pending_second_approval");

    const balancesAfterFirst = await request()
      .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(balancesAfterFirst.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId).used).toBe(0);

    const secondApprove = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(201);
    expect(secondApprove.body.status).toBe("approved");

    const balancesAfterSecond = await request()
      .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(balancesAfterSecond.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId).used).toBe(2);
  });

  it("rejects approving an already-resolved request", async () => {
    const staff = await createStaffMember("Already Resolved Staff");
    const leaveTypeId = await createLeaveType();
    const { startDate, endDate } = futureRange(5, 1);

    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(201);
    await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(201);

    const res = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(admin.accessToken))
      .expect(409);
    expect(res.body.code).toBe("LEAVE_REQUEST_NOT_PENDING");
  });

  it("requires leave.approve to approve/reject — leave.request alone is denied", async () => {
    const staff = await createStaffMember("Permission Staff");
    const leaveTypeId = await createLeaveType();
    const { startDate, endDate } = futureRange(5, 1);
    const created = await request()
      .post("/api/v1/leave/requests")
      .set(auth(staff.accessToken))
      .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
      .expect(201);

    const barber = await createUserWithRole(app, "Employee", [branchId]);
    const res = await request()
      .post(`/api/v1/leave/requests/${created.body.id}/approve`)
      .set(auth(barber.accessToken))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  describe("half-day ranges", () => {
    it("deducts 0.5 for a start-half-day on a multi-day range", async () => {
      const staff = await createStaffMember("Start Half Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 3);

      const res = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, startHalfDay: true, reason: "Test leave" })
        .expect(201);
      expect(res.body.daysCount).toBe(2.5);
    });

    it("deducts 0.5 for an end-half-day, and 1 full day for both boundaries half", async () => {
      const staff = await createStaffMember("End Half Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 3);

      const endOnly = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, endHalfDay: true, reason: "Test leave" })
        .expect(201);
      expect(endOnly.body.daysCount).toBe(2.5);

      const { startDate: s2, endDate: e2 } = futureRange(15, 3);
      const both = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate: s2, endDate: e2, startHalfDay: true, endHalfDay: true, reason: "Test leave" })
        .expect(201);
      expect(both.body.daysCount).toBe(2);
    });

    it("single-day half-day uses halfDayPeriod, not startHalfDay/endHalfDay", async () => {
      const staff = await createStaffMember("Single Half Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 1);

      const firstHalf = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(201);
      expect(firstHalf.body.daysCount).toBe(0.5);
      expect(firstHalf.body.halfDayPeriod).toBe("first_half");

      const rejectedShape = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, startHalfDay: true, reason: "Test leave" })
        .expect(400);
      expect(rejectedShape.body.code).toBe("VALIDATION_FAILED");

      const { startDate: s2, endDate: e2 } = futureRange(15, 3);
      const rangeWithPeriod = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate: s2, endDate: e2, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(400);
      expect(rangeWithPeriod.body.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("date conflicts", () => {
    it("rejects a second request overlapping an existing active one for the same staff", async () => {
      const staff = await createStaffMember("Conflict Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 1);

      await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);

      const conflict = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(409);
      expect(conflict.body.code).toBe("LEAVE_DATE_CONFLICT");
    });

    it("allows a first-half then a second-half request on the same single day", async () => {
      const staff = await createStaffMember("Half Day Pair Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 1);

      await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(201);

      const secondHalf = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "second_half", reason: "Test leave" })
        .expect(201);
      expect(secondHalf.body.daysCount).toBe(0.5);
    });

    it("rejects the same half requested twice on the same day", async () => {
      const staff = await createStaffMember("Same Half Staff");
      const leaveTypeId = await createLeaveType({ allowHalfDay: true });
      const { startDate, endDate } = futureRange(5, 1);

      await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(201);

      const conflict = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, halfDayPeriod: "first_half", reason: "Test leave" })
        .expect(409);
      expect(conflict.body.code).toBe("LEAVE_DATE_CONFLICT");
    });

    it("does not block against a rejected request on the same dates", async () => {
      const staff = await createStaffMember("Resolved Conflict Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);

      const first = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
      await request()
        .post(`/api/v1/leave/requests/${first.body.id}/reject`)
        .set(auth(admin.accessToken))
        .send({ rejectionReason: "no good" })
        .expect(201);

      await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
    });
  });

  describe("cancel", () => {
    it("reverses the balance and the on_leave attendance marking", async () => {
      const staff = await createStaffMember("Cancel Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 3);

      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
      await request()
        .post(`/api/v1/leave/requests/${created.body.id}/approve`)
        .set(auth(admin.accessToken))
        .expect(201);

      const dayBefore = await request()
        .get(`/api/v1/attendance/${staff.staffProfileId}/days/${startDate}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(dayBefore.body.status).toBe("on_leave");

      const cancelled = await request()
        .post(`/api/v1/leave/requests/${created.body.id}/cancel`)
        .set(auth(admin.accessToken))
        .send({ cancellationReason: "Plans changed" })
        .expect(201);
      expect(cancelled.body.status).toBe("cancelled");

      const balances = await request()
        .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId).used).toBe(0);

      const dayAfter = await request()
        .get(`/api/v1/attendance/${staff.staffProfileId}/days/${startDate}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(dayAfter.body.status).not.toBe("on_leave");
    });

    it("rejects cancelling a request that isn't approved", async () => {
      const staff = await createStaffMember("Not Approved Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);
      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);

      const res = await request()
        .post(`/api/v1/leave/requests/${created.body.id}/cancel`)
        .set(auth(admin.accessToken))
        .send({ cancellationReason: "Too soon" })
        .expect(409);
      expect(res.body.code).toBe("LEAVE_REQUEST_NOT_APPROVED");
    });
  });

  describe("self-service (requests/me, withdraw)", () => {
    it("requests/me returns only the caller's own requests, respecting the tab filter", async () => {
      const staff = await createStaffMember("Self List Staff");
      const other = await createStaffMember("Other Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);
      const { startDate: s2, endDate: e2 } = futureRange(15, 1);

      const mine = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
      await request()
        .post("/api/v1/leave/requests")
        .set(auth(other.accessToken))
        .send({ leaveTypeId, startDate: s2, endDate: e2, reason: "Test leave" })
        .expect(201);

      const list = await request().get("/api/v1/leave/requests/me").set(auth(staff.accessToken)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(mine.body.id);

      await request()
        .post(`/api/v1/leave/requests/${mine.body.id}/withdraw`)
        .set(auth(staff.accessToken))
        .expect(201);

      const cancelledTab = await request()
        .get("/api/v1/leave/requests/me")
        .query({ tab: "cancelled" })
        .set(auth(staff.accessToken))
        .expect(200);
      expect(cancelledTab.body.data).toHaveLength(1);
      expect(cancelledTab.body.data[0].status).toBe("cancelled");

      const pendingTab = await request()
        .get("/api/v1/leave/requests/me")
        .query({ tab: "pending" })
        .set(auth(staff.accessToken))
        .expect(200);
      expect(pendingTab.body.data).toHaveLength(0);
    });

    it("withdraw cancels a pending request with no balance or attendance side effects", async () => {
      const staff = await createStaffMember("Withdraw Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 2);

      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);

      const withdrawn = await request()
        .post(`/api/v1/leave/requests/${created.body.id}/withdraw`)
        .set(auth(staff.accessToken))
        .expect(201);
      expect(withdrawn.body.status).toBe("cancelled");

      const balances = await request()
        .get(`/api/v1/leave/balances/${staff.staffProfileId}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(balances.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === leaveTypeId).used).toBe(0);

      const day = await request()
        .get(`/api/v1/attendance/${staff.staffProfileId}/days/${startDate}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(day.body.status).not.toBe("on_leave");
    });

    it("rejects withdrawing a request that is no longer pending", async () => {
      const staff = await createStaffMember("Already Approved Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);

      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
      await request()
        .post(`/api/v1/leave/requests/${created.body.id}/approve`)
        .set(auth(admin.accessToken))
        .expect(201);

      const res = await request()
        .post(`/api/v1/leave/requests/${created.body.id}/withdraw`)
        .set(auth(staff.accessToken))
        .expect(409);
      expect(res.body.code).toBe("LEAVE_REQUEST_NOT_PENDING");
    });

    it("rejects withdrawing another staff member's pending request", async () => {
      const staff = await createStaffMember("Owner Staff");
      const intruder = await createStaffMember("Intruder Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);

      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);

      const res = await request()
        .post(`/api/v1/leave/requests/${created.body.id}/withdraw`)
        .set(auth(intruder.accessToken))
        .expect(403);
      expect(res.body.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("detail and history", () => {
    it("builds the approval timeline from the audit log", async () => {
      const staff = await createStaffMember("History Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 2);

      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Trip" })
        .expect(201);
      await request()
        .post(`/api/v1/leave/requests/${created.body.id}/approve`)
        .set(auth(admin.accessToken))
        .expect(201);

      const detail = await request()
        .get(`/api/v1/leave/requests/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(detail.body.reason).toBe("Trip");
      const actions = detail.body.history.map((h: { action: string }) => h.action);
      expect(actions).toEqual(["leave_request.created", "leave_request.approved"]);
      expect(detail.body.history.every((h: { actorName: string | null }) => !!h.actorName)).toBe(true);
    });

    it("records the rejection reason as a history note", async () => {
      const staff = await createStaffMember("History Reject Staff");
      const leaveTypeId = await createLeaveType();
      const { startDate, endDate } = futureRange(5, 1);
      const created = await request()
        .post("/api/v1/leave/requests")
        .set(auth(staff.accessToken))
        .send({ leaveTypeId, startDate, endDate, reason: "Test leave" })
        .expect(201);
      await request()
        .post(`/api/v1/leave/requests/${created.body.id}/reject`)
        .set(auth(admin.accessToken))
        .send({ rejectionReason: "No coverage" })
        .expect(201);

      const detail = await request()
        .get(`/api/v1/leave/requests/${created.body.id}`)
        .set(auth(admin.accessToken))
        .expect(200);
      const rejectedEntry = detail.body.history.find((h: { action: string }) => h.action === "leave_request.rejected");
      expect(rejectedEntry.note).toBe("No coverage");
    });

  });

  describe("attachments", () => {
    it("presigns an upload URL under the leave-attachments prefix", async () => {
      const res = await request()
        .post("/api/v1/leave/attachments/presign-upload")
        .set(auth(admin.accessToken))
        .send({ fileName: "medical-note.pdf", contentType: "application/pdf" })
        .expect(201);
      expect(res.body.uploadUrl).toMatch(/^https?:\/\//);
      expect(res.body.key).toContain("leave-attachments/");
      expect(res.body.key).toContain("medical-note.pdf");
    });
  });
});
