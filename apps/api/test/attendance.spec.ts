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

describe("attendance", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantB: TestTenant;
  let db: AuthPrismaService;
  let branchId: string;
  let managerRoleId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let mobileCounter = 80000000;

  /** Creates a staff member (Branch Manager role — has attendance.mark/view/edit) and logs them in. */
  async function createStaffMember(
    name: string,
    opts: { branchId?: string } = {},
  ): Promise<{ userId: string; staffProfileId: string; accessToken: string }> {
    const suffix = randomUUID().slice(0, 8);
    const username = `staff-${suffix}`;
    const password = "Staff@12345";
    const res = await request()
      .post("/api/v1/users")
      .set(auth(tenant.accessToken))
      .send({
        name,
        username,
        email: `${username}@test.hayryou`,
        mobile: `+968${++mobileCounter}`,
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
    const profile = await db.staffProfile.findUniqueOrThrow({ where: { userId } });
    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: username, password })
      .expect(200);
    return { userId, staffProfileId: profile.id, accessToken: login.body.tokens.accessToken as string };
  }

  function isoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Most recent PAST date (strictly before today) whose weekday matches, e.g. "friday". */
  function mostRecentPastWeekday(weekday: string): Date {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const target = names.indexOf(weekday);
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    do {
      d.setUTCDate(d.getUTCDate() - 1);
    } while (d.getUTCDay() !== target);
    return d;
  }

  /** Most recent PAST date that is NOT a weekly-off day. */
  function mostRecentPastWorkingDay(weeklyOffDays: string[]): Date {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    do {
      d.setUTCDate(d.getUTCDate() - 1);
    } while (weeklyOffDays.includes(names[d.getUTCDay()]!));
    return d;
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(AuthPrismaService);
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send({
        ...validBranchPayload("Attendance Branch"),
        workingHours: { openingTime: "09:00", closingTime: "18:00", weeklyOffDays: ["friday"] },
      })
      .expect(201);
    branchId = branch.body.id;

    const roles = await request().get("/api/v1/roles").set(auth(tenant.accessToken)).expect(200);
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("self check-in / check-out happy path, and rejects double actions", async () => {
    const staff = await createStaffMember("Check In Staff");

    const before = await request()
      .get("/api/v1/attendance/me/today")
      .set(auth(staff.accessToken))
      .expect(200);
    expect(before.body.isCheckedIn).toBe(false);
    expect(before.body.sessions).toHaveLength(0);

    const checkIn = await request()
      .post("/api/v1/attendance/check-in")
      .set(auth(staff.accessToken))
      .expect(201);
    expect(checkIn.body.isCheckedIn).toBe(true);
    expect(checkIn.body.sessions).toHaveLength(1);
    expect(checkIn.body.sessions[0].checkOutAt).toBeNull();

    const doubleCheckIn = await request()
      .post("/api/v1/attendance/check-in")
      .set(auth(staff.accessToken))
      .expect(409);
    expect(doubleCheckIn.body.code).toBe("ATTENDANCE_ALREADY_CHECKED_IN");

    const checkOut = await request()
      .post("/api/v1/attendance/check-out")
      .set(auth(staff.accessToken))
      .expect(201);
    expect(checkOut.body.isCheckedIn).toBe(false);
    expect(checkOut.body.sessions[0].checkOutAt).not.toBeNull();
    expect(checkOut.body.totalWorkedMinutes).toBeGreaterThanOrEqual(0);

    const doubleCheckOut = await request()
      .post("/api/v1/attendance/check-out")
      .set(auth(staff.accessToken))
      .expect(409);
    expect(doubleCheckOut.body.code).toBe("ATTENDANCE_NOT_CHECKED_IN");
  });

  it("supports multiple sessions in one day with derived break time", async () => {
    const staff = await createStaffMember("Multi Session Staff");

    await request().post("/api/v1/attendance/check-in").set(auth(staff.accessToken)).expect(201);
    await request().post("/api/v1/attendance/check-out").set(auth(staff.accessToken)).expect(201);
    await request().post("/api/v1/attendance/check-in").set(auth(staff.accessToken)).expect(201);
    const final = await request()
      .get("/api/v1/attendance/me/today")
      .set(auth(staff.accessToken))
      .expect(200);

    expect(final.body.sessions).toHaveLength(2);
    expect(final.body.sessions[0].breakMinutesBefore).toBeNull();
    expect(final.body.sessions[1].breakMinutesBefore).toBeGreaterThanOrEqual(0);
    expect(final.body.isCheckedIn).toBe(true);
  });

  it("admin can view and correct another staff member's day; stamps manual-entry audit fields", async () => {
    const staff = await createStaffMember("Edited Staff");
    // A past working day, not "today" — session times below must be safely before "now"
    // regardless of what time the test suite happens to run at (future entries are rejected).
    const today = isoDate(mostRecentPastWorkingDay(["friday"]));

    const detailBefore = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(detailBefore.body.sessions).toHaveLength(0);
    expect(detailBefore.body.status).toBe("absent");

    const lateCheckIn = `${today}T10:00:00.000Z`; // branch opens 09:00 + 15min grace → late
    const edited = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: lateCheckIn, checkOutAt: `${today}T17:00:00.000Z` }] })
      .expect(200);

    expect(edited.body.status).toBe("late");
    expect(edited.body.isManualEntry).toBe(true);
    expect(edited.body.editedByUserId).toBeTruthy();
    expect(edited.body.editedAt).toBeTruthy();
    expect(edited.body.totalWorkedMinutes).toBe(7 * 60);
  });

  it("rejects conflicting sessions on edit: overlap, an open session before the last, and checkout before check-in", async () => {
    const staff = await createStaffMember("Conflict Staff");
    // A past working day — session times below must be safely before "now" (future entries
    // are rejected), independent of what time the test suite happens to run at.
    const today = isoDate(mostRecentPastWorkingDay(["friday"]));

    const overlap = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({
        sessions: [
          { checkInAt: `${today}T09:00:00.000Z`, checkOutAt: `${today}T12:00:00.000Z` },
          { checkInAt: `${today}T11:00:00.000Z`, checkOutAt: `${today}T15:00:00.000Z` },
        ],
      })
      .expect(400);
    expect(overlap.body.code).toBe("VALIDATION_FAILED");

    const openNotLast = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({
        sessions: [
          { checkInAt: `${today}T09:00:00.000Z`, checkOutAt: null },
          { checkInAt: `${today}T13:00:00.000Z`, checkOutAt: `${today}T15:00:00.000Z` },
        ],
      })
      .expect(400);
    expect(openNotLast.body.code).toBe("VALIDATION_FAILED");

    const checkoutBeforeCheckin = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: `${today}T12:00:00.000Z`, checkOutAt: `${today}T09:00:00.000Z` }] })
      .expect(400);
    expect(checkoutBeforeCheckin.body.code).toBe("VALIDATION_FAILED");

    // A trailing open session after a closed one is valid (the normal "still clocked in" shape).
    const valid = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({
        sessions: [
          { checkInAt: `${today}T09:00:00.000Z`, checkOutAt: `${today}T12:00:00.000Z` },
          { checkInAt: `${today}T13:00:00.000Z`, checkOutAt: null },
        ],
      })
      .expect(200);
    expect(valid.body.sessions).toHaveLength(2);
  });

  it("rejects a future check-in or check-out on edit", async () => {
    const staff = await createStaffMember("Future Entry Staff");
    const today = isoDate(new Date());
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

    const futureCheckIn = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: future, checkOutAt: null }] })
      .expect(400);
    expect(futureCheckIn.body.code).toBe("VALIDATION_FAILED");

    const futureCheckOut = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: `${today}T09:00:00.000Z`, checkOutAt: future }] })
      .expect(400);
    expect(futureCheckOut.body.code).toBe("VALIDATION_FAILED");
  });

  it("derives weekly_off and absent for past dates with no activity, without a stored row", async () => {
    const staff = await createStaffMember("Derivation Staff");
    const fridayDate = isoDate(mostRecentPastWeekday("friday"));
    const workingDate = isoDate(mostRecentPastWorkingDay(["friday"]));

    const weeklyOff = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${fridayDate}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(weeklyOff.body.status).toBe("weekly_off");

    const absent = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${workingDate}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(absent.body.status).toBe("absent");
  });

  it("Today list includes staff with zero activity as pending, not absent", async () => {
    // Its own branch with no weekly-off days: "today" must resolve to `pending` regardless of which
    // real calendar weekday CI happens to run on — the shared `branchId` is Friday-off and would
    // incorrectly return `weekly_off` instead whenever a run lands on a Friday.
    const pendingBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send({
        ...validBranchPayload("Pending Today Branch"),
        workingHours: { openingTime: "09:00", closingTime: "18:00", weeklyOffDays: [] },
      })
      .expect(201);
    const pendingBranchId = pendingBranch.body.id as string;
    const staff = await createStaffMember("Pending Today Staff", { branchId: pendingBranchId });
    const today = isoDate(new Date());

    const list = await request()
      .get(`/api/v1/attendance?scope=today&date=${today}&branchId=${pendingBranchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const row = list.body.data.find(
      (r: { staff: { id: string } }) => r.staff.id === staff.staffProfileId,
    );
    expect(row.status).toBe("pending");

    const kpis = await request()
      .get(`/api/v1/attendance/kpis?scope=today&date=${today}&branchId=${pendingBranchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    // a staff member with no session yet must not be counted as absent
    expect(kpis.body.absent).toBe(0);
  });

  it("excludes staff from an inactive branch when scope is All branches, but not when that branch is explicit", async () => {
    const inactiveBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      // weeklyOffDays: [] — see the "pending, not absent" test above for why "today" must not
      // collide with a weekly-off day regardless of which real calendar weekday CI runs on.
      .send({
        ...validBranchPayload("Soon Inactive Branch"),
        workingHours: { openingTime: "09:00", closingTime: "21:00", weeklyOffDays: [] },
      })
      .expect(201);
    const inactiveBranchId = inactiveBranch.body.id as string;
    const staff = await createStaffMember("Inactive Branch Staff", { branchId: inactiveBranchId });
    const today = isoDate(new Date());

    await request()
      .patch(`/api/v1/branches/${inactiveBranchId}`)
      .set(auth(tenant.accessToken))
      .send({ status: "inactive" })
      .expect(200);

    const allBranches = await request()
      .get(`/api/v1/attendance?scope=today&date=${today}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(
      allBranches.body.data.some((r: { staff: { id: string } }) => r.staff.id === staff.staffProfileId),
    ).toBe(false);

    const direct = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(direct.body.status).toBe("pending");
  });

  it("Monthly aggregate and per-staff detail reflect corrected days", async () => {
    const staff = await createStaffMember("Monthly Staff");
    const workingDate = mostRecentPastWorkingDay(["friday"]);
    const dateStr = isoDate(workingDate);
    const month = dateStr.slice(0, 7);

    await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${dateStr}`)
      .set(auth(tenant.accessToken))
      .send({ sessions: [{ checkInAt: `${dateStr}T09:05:00.000Z`, checkOutAt: `${dateStr}T18:00:00.000Z` }] })
      .expect(200);

    const monthlyList = await request()
      .get(`/api/v1/attendance?scope=monthly&month=${month}&branchId=${branchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const row = monthlyList.body.data.find(
      (r: { staff: { id: string } }) => r.staff.id === staff.staffProfileId,
    );
    expect(row.presentDays).toBeGreaterThanOrEqual(1);
    expect(row.totalWorkedMinutes).toBeGreaterThanOrEqual(1);

    const detail = await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/monthly?month=${month}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const dayRow = detail.body.days.find((d: { date: string }) => d.date.slice(0, 10) === dateStr);
    expect(dayRow.status).toBe("present");
    expect(dayRow.sessionCount).toBe(1);
  });

  it("tenant B never sees tenant A's staff attendance (cross-tenant isolation)", async () => {
    const staff = await createStaffMember("Isolated Staff");
    const today = isoDate(new Date());

    await request()
      .get(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(tenantB.accessToken))
      .expect(404);
  });

  it("requires attendance.view for the list/detail endpoints and attendance.edit for corrections", async () => {
    const staff = await createStaffMember("Permission Staff");
    const today = isoDate(new Date());
    const noAttendancePerms = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);

    const listDenied = await request()
      .get(`/api/v1/attendance?scope=today&date=${today}`)
      .set(auth(noAttendancePerms.accessToken))
      .expect(403);
    expect(listDenied.body.code).toBe("PERMISSION_DENIED");

    const editDenied = await request()
      .patch(`/api/v1/attendance/${staff.staffProfileId}/days/${today}`)
      .set(auth(noAttendancePerms.accessToken))
      .send({ sessions: [] })
      .expect(403);
    expect(editDenied.body.code).toBe("PERMISSION_DENIED");
  });
});
