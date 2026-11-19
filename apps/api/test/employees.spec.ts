import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createTestAdmin,
  createUserWithRole,
  validBranchPayload,
  type TestAdmin,
} from "./helpers";
import { PrismaService } from "../src/database/prisma.service";

const validUserPayload = (roleId: string, branchIds: string[]) => {
  const suffix = randomUUID().slice(0, 8);
  return {
    name: `Staff ${suffix}`,
    username: `staff-${suffix}`,
    email: `staff-${suffix}@test.keystonehr`,
    mobile: "+971501234567",
    gender: "male",
    employmentType: "full_time",
    primaryBranchId: branchIds[0],
    password: "Staff@12345",
    roleId,
    branchIds,
  };
};

describe("employee management", () => {
  let app: INestApplication;
  let admin: TestAdmin;
  let branch1Id: string;
  let branch2Id: string;
  let employeeRoleId: string;
  let managerRoleId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    admin = await createTestAdmin(app);

    for (const name of ["Employees One", "Employees Two"]) {
      const res = await request()
        .post("/api/v1/branches")
        .set("Authorization", `Bearer ${admin.accessToken}`)
        .send(validBranchPayload(name))
        .expect(201);
      if (name === "Employees One") branch1Id = res.body.id;
      else branch2Id = res.body.id;
    }

    const roles = await request()
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    employeeRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Employee").id;
    managerRoleId = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager").id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists the seeded system roles", async () => {
    const res = await request()
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    const names = res.body.map((r: { nameEn: string }) => r.nameEn);
    expect(names).toContain("Super Admin");
    expect(names).toContain("Employee");
    expect(res.body.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
  });

  it("GET /employees/me includes the caller's permission set, scoped to their role", async () => {
    const adminMe = await request()
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(adminMe.body.permissions).toContain("roles.manage");

    const employeeUser = await createUserWithRole(app, "Employee", [branch1Id]);
    const me = await request()
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${employeeUser.accessToken}`)
      .expect(200);
    expect(me.body.permissions).not.toContain("roles.manage");
    expect(me.body.permissions.length).toBeGreaterThan(0);
  });

  it("creates a user with branch assignments, audits it, and the user can log in", async () => {
    const payload = validUserPayload(employeeRoleId, [branch1Id, branch2Id]);
    const res = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(payload)
      .expect(201);

    expect(res.body.username).toBe(payload.username);
    expect(res.body.role.nameEn).toBe("Employee");
    expect(res.body.branchIds.sort()).toEqual([branch1Id, branch2Id].sort());
    expect(res.body.passwordHash).toBeUndefined();

    const db = app.get(PrismaService);
    const entry = await db.client.auditLog.findFirst({
      where: { action: "user.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();

    await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: payload.password })
      .expect(200);
  });

  it("rejects duplicate username and email with stable codes", async () => {
    const payload = validUserPayload(employeeRoleId, [branch1Id]);
    await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(payload)
      .expect(201);

    const dupUsername = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...payload, email: `other-${randomUUID().slice(0, 8)}@test.keystonehr` })
      .expect(409);
    expect(dupUsername.body.code).toBe("USERNAME_EXISTS");

    const dupEmail = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...payload, username: `other-${randomUUID().slice(0, 8)}` })
      .expect(409);
    expect(dupEmail.body.code).toBe("EMAIL_EXISTS");
  });

  it("rejects weak passwords and missing branch assignment", async () => {
    const weak = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...validUserPayload(employeeRoleId, [branch1Id]), password: "short" })
      .expect(400);
    expect(weak.body.code).toBe("VALIDATION_FAILED");

    const noBranches = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...validUserPayload(employeeRoleId, []), allBranches: false })
      .expect(400);
    expect(noBranches.body.code).toBe("VALIDATION_FAILED");
  });

  it("denies employee management to roles without employee.create/employee.view", async () => {
    const employeeUser = await createUserWithRole(app, "Employee", [branch1Id]);
    const createRes = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${employeeUser.accessToken}`)
      .send(validUserPayload(employeeRoleId, [branch1Id]))
      .expect(403);
    expect(createRes.body.code).toBe("PERMISSION_DENIED");

    await request()
      .get("/api/v1/employees")
      .set("Authorization", `Bearer ${employeeUser.accessToken}`)
      .expect(403);
  });

  it("lets an employee.view-only role list employees but denies editing and password reset", async () => {
    const branchManager = await createUserWithRole(app, "Branch Manager", [branch1Id]);

    await request()
      .get("/api/v1/employees")
      .set("Authorization", `Bearer ${branchManager.accessToken}`)
      .expect(200);

    const createRes = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${branchManager.accessToken}`)
      .send(validUserPayload(employeeRoleId, [branch1Id]))
      .expect(403);
    expect(createRes.body.code).toBe("PERMISSION_DENIED");

    const resetRes = await request()
      .post(`/api/v1/employees/${branchManager.userId}/reset-password`)
      .set("Authorization", `Bearer ${branchManager.accessToken}`)
      .send({ password: "NewPass@12345" })
      .expect(403);
    expect(resetRes.body.code).toBe("PERMISSION_DENIED");
  });

  it("scopes the employee list and detail lookup to the caller's assigned branches", async () => {
    const branch2Only = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(validUserPayload(employeeRoleId, [branch2Id]))
      .expect(201);

    const branchManager = await createUserWithRole(app, "Branch Manager", [branch1Id]);

    const list = await request()
      .get("/api/v1/employees")
      .set("Authorization", `Bearer ${branchManager.accessToken}`)
      .expect(200);
    expect(list.body.data.some((u: { id: string }) => u.id === branch2Only.body.id)).toBe(false);

    const detail = await request()
      .get(`/api/v1/employees/${branch2Only.body.id}`)
      .set("Authorization", `Bearer ${branchManager.accessToken}`)
      .expect(403);
    expect(detail.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("paginates and filters the employee list", async () => {
    const res = await request()
      .get(`/api/v1/employees?pageSize=2&roleId=${employeeRoleId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.pageSize).toBe(2);
    expect(res.body.data.every((u: { role: { id: string } }) => u.role.id === employeeRoleId)).toBe(
      true,
    );

    const payload = validUserPayload(employeeRoleId, [branch1Id]);
    await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(payload)
      .expect(201);
    const search = await request()
      .get(`/api/v1/employees?search=${payload.username}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(search.body.meta.total).toBe(1);
    expect(search.body.data[0].username).toBe(payload.username);
  });

  it("replaces branch assignments wholesale on update", async () => {
    const created = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(validUserPayload(managerRoleId, [branch1Id]))
      .expect(201);

    // Primary branch is locked into Assigned Branches, so moving it out entirely
    // is rejected — the wholesale replace must carry the primary branch along.
    const rejected = await request()
      .patch(`/api/v1/employees/${created.body.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ branchIds: [branch2Id] })
      .expect(400);
    expect(rejected.body.code).toBe("VALIDATION_FAILED");

    const updated = await request()
      .patch(`/api/v1/employees/${created.body.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ branchIds: [branch2Id], primaryBranchId: branch2Id })
      .expect(200);
    expect(updated.body.branchIds).toEqual([branch2Id]);
  });

  it("deactivation blocks login and revokes refresh tokens", async () => {
    const payload = validUserPayload(employeeRoleId, [branch1Id]);
    const created = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(payload)
      .expect(201);

    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: payload.password })
      .expect(200);
    const refreshToken = login.body.tokens.refreshToken;

    await request()
      .patch(`/api/v1/employees/${created.body.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "inactive" })
      .expect(200);

    const blocked = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: payload.password })
      .expect(401);
    expect(blocked.body.code).toBe("ACCOUNT_INACTIVE");

    await request().post("/api/v1/auth/refresh").send({ refreshToken }).expect(401);
  });

  it("creates a staff member with employment, salary, commission and allowances/deductions", async () => {
    const allowance = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(admin.accessToken))
      .send({
        items: [
          { nameEn: `Housing ${randomUUID().slice(0, 6)}`, nameAr: "سكن", basis: "fixed_amount", defaultAmountMinor: 50000 },
        ],
      })
      .expect(200);
    const deduction = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(admin.accessToken))
      .send({
        items: [
          { nameEn: `PASI ${randomUUID().slice(0, 6)}`, nameAr: "التأمينات", basis: "percentage_of_base", defaultRatePct: 7 },
        ],
      })
      .expect(200);

    const me = await request()
      .get("/api/v1/employees/me")
      .set(auth(admin.accessToken))
      .expect(200);

    const payload = {
      ...validUserPayload(employeeRoleId, [branch1Id]),
      mobile: "+971501234567",
      gender: "male",
      staffStatus: "active",
      primaryBranchId: branch1Id,
      employmentType: "full_time",
      joiningDate: "2026-01-01",
      reportingManagerId: me.body.id,
      baseSalaryMinor: 380000,
      commissionEnabled: true,
      commissionRatePct: 40,
      allowances: [{ payrollComponentId: allowance.body[0].id, amountMinor: 50000 }],
      deductions: [{ payrollComponentId: deduction.body[0].id, amountMinor: 26600 }],
    };

    const res = await request()
      .post("/api/v1/employees")
      .set(auth(admin.accessToken))
      .send(payload)
      .expect(201);

    expect(res.body.employmentType).toBe("full_time");
    expect(res.body.reportingManager.id).toBe(me.body.id);
    expect(res.body.allowances).toHaveLength(1);
    expect(res.body.deductions).toHaveLength(1);
    expect(res.body.grossSalaryMinor).toBe(430000); // 380000 + 50000
    expect(res.body.netSalaryMinor).toBe(403400); // 430000 - 26600
  });

  it("rejects a staff member reporting to themselves", async () => {
    const created = await request()
      .post("/api/v1/employees")
      .set(auth(admin.accessToken))
      .send(validUserPayload(employeeRoleId, [branch1Id]))
      .expect(201);

    const res = await request()
      .patch(`/api/v1/employees/${created.body.id}`)
      .set(auth(admin.accessToken))
      .send({ reportingManagerId: created.body.id })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects an allowance id that is actually a deduction component", async () => {
    const deduction = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(admin.accessToken))
      .send({
        items: [{ nameEn: `Other ${randomUUID().slice(0, 6)}`, nameAr: "أخرى", basis: "fixed_amount", defaultAmountMinor: 1000 }],
      })
      .expect(200);

    const res = await request()
      .post("/api/v1/employees")
      .set(auth(admin.accessToken))
      .send({
        ...validUserPayload(employeeRoleId, [branch1Id]),
        allowances: [{ payrollComponentId: deduction.body[0].id, amountMinor: 1000 }],
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("blocks changing your own status or role", async () => {
    const me = await request()
      .get("/api/v1/employees/me")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);

    const res = await request()
      .patch(`/api/v1/employees/${me.body.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "inactive" })
      .expect(403);
    expect(res.body.code).toBe("CANNOT_MODIFY_SELF");
  });

  it("reset-password rotates credentials and revokes sessions", async () => {
    const payload = validUserPayload(employeeRoleId, [branch1Id]);
    const created = await request()
      .post("/api/v1/employees")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(payload)
      .expect(201);

    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: payload.password })
      .expect(200);

    await request()
      .post(`/api/v1/employees/${created.body.id}/reset-password`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ password: "NewPass@123" })
      .expect(201);

    await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: payload.password })
      .expect(401);
    await request()
      .post("/api/v1/auth/login")
      .send({ identifier: payload.username, password: "NewPass@123" })
      .expect(200);
    await request()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: login.body.tokens.refreshToken })
      .expect(401);
  });
});
