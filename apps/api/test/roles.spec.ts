import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, createUserWithRole, validBranchPayload, type TestAdmin } from "./helpers";
import { PrismaService } from "../src/database/prisma.service";

describe("roles (Settings > Roles & Permissions)", () => {
  let app: INestApplication;
  let admin: TestAdmin;
  let db: PrismaService;
  let branchId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    admin = await createTestAdmin(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(admin.accessToken))
      .send(validBranchPayload("Roles Branch"))
      .expect(201);
    branchId = branch.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists role summaries with staff counts", async () => {
    const res = await request()
      .get("/api/v1/roles/summaries")
      .set(auth(admin.accessToken))
      .expect(200);
    const superAdmin = res.body.find((r: { nameEn: string }) => r.nameEn === "Super Admin");
    expect(superAdmin.isSuperAdmin).toBe(true);
    expect(superAdmin.nameAr).toBe("مسؤول عام");
    expect(superAdmin.employeeCount).toBeGreaterThanOrEqual(1);
    const employee = res.body.find((r: { nameEn: string }) => r.nameEn === "Employee");
    expect(employee.isSuperAdmin).toBe(false);
    expect(employee.isSystem).toBe(true);
  });

  it("creates a custom role, fetches its detail, updates its name and permissions", async () => {
    const created = await request()
      .post("/api/v1/roles")
      .set(auth(admin.accessToken))
      .send({ nameEn: "Shift Lead", nameAr: "قائد مناوبة", permissionKeys: ["attendance.view", "attendance.mark"] })
      .expect(201);
    expect(created.body.isSystem).toBe(false);
    expect(created.body.isSuperAdmin).toBe(false);
    expect(created.body.permissionKeys.sort()).toEqual(["attendance.mark", "attendance.view"]);

    const detail = await request()
      .get(`/api/v1/roles/${created.body.id}`)
      .set(auth(admin.accessToken))
      .expect(200);
    expect(detail.body.nameEn).toBe("Shift Lead");
    expect(detail.body.nameAr).toBe("قائد مناوبة");

    const updated = await request()
      .patch(`/api/v1/roles/${created.body.id}`)
      .set(auth(admin.accessToken))
      .send({
        nameEn: "Senior Shift Lead",
        nameAr: "قائد مناوبة أول",
        permissionKeys: ["attendance.view", "attendance.edit"],
      })
      .expect(200);
    expect(updated.body.nameEn).toBe("Senior Shift Lead");
    expect(updated.body.nameAr).toBe("قائد مناوبة أول");
    expect(updated.body.permissionKeys.sort()).toEqual(["attendance.edit", "attendance.view"]);
  });

  it("rejects an unknown permission key", async () => {
    const res = await request()
      .post("/api/v1/roles")
      .set(auth(admin.accessToken))
      .send({ nameEn: "Bad Role", nameAr: "دور سيئ", permissionKeys: ["not.a.real.key"] })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a duplicate role name", async () => {
    await request()
      .post("/api/v1/roles")
      .set(auth(admin.accessToken))
      .send({ nameEn: "Dup Role", nameAr: "دور مكرر", permissionKeys: [] })
      .expect(201);
    const res = await request()
      .post("/api/v1/roles")
      .set(auth(admin.accessToken))
      .send({ nameEn: "Dup Role", nameAr: "دور مكرر آخر", permissionKeys: [] })
      .expect(409);
    expect(res.body.code).toBe("NAME_EXISTS");
  });

  it("allows editing a seeded system role's name and permissions (only Super Admin is protected)", async () => {
    const roles = await request().get("/api/v1/roles/summaries").set(auth(admin.accessToken)).expect(200);
    const branchManager = roles.body.find((r: { nameEn: string }) => r.nameEn === "Branch Manager");

    const updated = await request()
      .patch(`/api/v1/roles/${branchManager.id}`)
      .set(auth(admin.accessToken))
      .send({ nameEn: "Branch Manager", nameAr: "مدير فرع", permissionKeys: ["branches.view"] })
      .expect(200);
    expect(updated.body.permissionKeys).toEqual(["branches.view"]);

    // restore so later/parallel assertions about Branch Manager's original permission set elsewhere aren't affected
    await request()
      .patch(`/api/v1/roles/${branchManager.id}`)
      .set(auth(admin.accessToken))
      .send({
        nameEn: "Branch Manager",
        nameAr: "مدير فرع",
        permissionKeys: ["employee.view", "attendance.view", "attendance.edit", "leave.view", "leave.approve", "payroll.view", "branches.view"],
      })
      .expect(200);
  });

  it("blocks editing and deleting the Super Admin role", async () => {
    const roles = await request().get("/api/v1/roles/summaries").set(auth(admin.accessToken)).expect(200);
    const superAdmin = roles.body.find((r: { nameEn: string }) => r.nameEn === "Super Admin");

    const patchRes = await request()
      .patch(`/api/v1/roles/${superAdmin.id}`)
      .set(auth(admin.accessToken))
      .send({ nameEn: "Not Super Admin", nameAr: "ليس مسؤولاً عاماً", permissionKeys: [] })
      .expect(403);
    expect(patchRes.body.code).toBe("ROLE_PROTECTED");

    const deleteRes = await request()
      .delete(`/api/v1/roles/${superAdmin.id}`)
      .set(auth(admin.accessToken))
      .expect(403);
    expect(deleteRes.body.code).toBe("ROLE_PROTECTED");
  });

  it("blocks deleting a role currently assigned to staff, succeeds after reassignment", async () => {
    const created = await request()
      .post("/api/v1/roles")
      .set(auth(admin.accessToken))
      .send({ nameEn: "Temp Role", nameAr: "دور مؤقت", permissionKeys: [] })
      .expect(201);
    const roleId = created.body.id as string;

    const staff = await createUserWithRole(app, "Temp Role", [branchId]);

    const blocked = await request()
      .delete(`/api/v1/roles/${roleId}`)
      .set(auth(admin.accessToken))
      .expect(409);
    expect(blocked.body.code).toBe("ROLE_IN_USE");

    const roles = await request().get("/api/v1/roles/summaries").set(auth(admin.accessToken)).expect(200);
    const employeeRole = roles.body.find((r: { nameEn: string }) => r.nameEn === "Employee");
    await db.client.user.update({ where: { id: staff.userId }, data: { roleId: employeeRole.id } });

    await request().delete(`/api/v1/roles/${roleId}`).set(auth(admin.accessToken)).expect(200);
  });

  it("returns 403 without roles.manage", async () => {
    const employeeUser = await createUserWithRole(app, "Employee", [branchId]);

    const denied = await request()
      .get("/api/v1/roles/summaries")
      .set(auth(employeeUser.accessToken))
      .expect(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
  });
});
