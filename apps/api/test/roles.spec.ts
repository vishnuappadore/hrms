import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createUserWithRole, provisionTenant, validBranchPayload, type TestTenant } from "./helpers";
import { AuthPrismaService } from "../src/database/auth-prisma.service";

describe("roles (Settings > Roles & Permissions)", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantB: TestTenant;
  let db: AuthPrismaService;
  let branchId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(AuthPrismaService);
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
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
      .set(auth(tenant.accessToken))
      .expect(200);
    const superAdmin = res.body.find((r: { nameEn: string }) => r.nameEn === "Super Admin");
    expect(superAdmin.isSuperAdmin).toBe(true);
    expect(superAdmin.nameAr).toBe("مسؤول عام");
    expect(superAdmin.staffCount).toBeGreaterThanOrEqual(1); // the provisioning admin holds it
    const barber = res.body.find((r: { nameEn: string }) => r.nameEn === "Barber");
    expect(barber.isSuperAdmin).toBe(false);
    expect(barber.isSystem).toBe(true);
    expect(barber.nameAr).toBe("حلاق");
  });

  it("creates a custom role, fetches its detail, updates its name and permissions", async () => {
    const created = await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Shift Lead", nameAr: "قائد مناوبة", permissionKeys: ["attendance.view", "attendance.mark"] })
      .expect(201);
    expect(created.body.isSystem).toBe(false);
    expect(created.body.isSuperAdmin).toBe(false);
    expect(created.body.permissionKeys.sort()).toEqual(["attendance.mark", "attendance.view"]);

    const detail = await request()
      .get(`/api/v1/roles/${created.body.id}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(detail.body.nameEn).toBe("Shift Lead");
    expect(detail.body.nameAr).toBe("قائد مناوبة");

    const updated = await request()
      .patch(`/api/v1/roles/${created.body.id}`)
      .set(auth(tenant.accessToken))
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
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Bad Role", nameAr: "دور سيئ", permissionKeys: ["not.a.real.key"] })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a duplicate role name within the same tenant", async () => {
    await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Dup Role", nameAr: "دور مكرر", permissionKeys: [] })
      .expect(201);
    const res = await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Dup Role", nameAr: "دور مكرر آخر", permissionKeys: [] })
      .expect(409);
    expect(res.body.code).toBe("NAME_EXISTS");
  });

  it("allows the same role name in a different tenant", async () => {
    await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Cross Tenant Role", nameAr: "دور عبر المستأجرين", permissionKeys: [] })
      .expect(201);
    await request()
      .post("/api/v1/roles")
      .set(auth(tenantB.accessToken))
      .send({ nameEn: "Cross Tenant Role", nameAr: "دور عبر المستأجرين", permissionKeys: [] })
      .expect(201);
  });

  it("allows editing a seeded system role's name and permissions (only Super Admin is protected)", async () => {
    const roles = await request().get("/api/v1/roles/summaries").set(auth(tenant.accessToken)).expect(200);
    const barber = roles.body.find((r: { nameEn: string }) => r.nameEn === "Barber");

    const updated = await request()
      .patch(`/api/v1/roles/${barber.id}`)
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Barber", nameAr: "حلاق", permissionKeys: ["appointments.view"] })
      .expect(200);
    expect(updated.body.permissionKeys).toEqual(["appointments.view"]);

    // restore so later/parallel assertions about Barber's original permission set elsewhere aren't affected
    await request()
      .patch(`/api/v1/roles/${barber.id}`)
      .set(auth(tenant.accessToken))
      .send({
        nameEn: "Barber",
        nameAr: "حلاق",
        permissionKeys: ["appointments.view", "services.view", "customers.view", "attendance.mark", "leave.request"],
      })
      .expect(200);
  });

  it("blocks editing and deleting the Super Admin role", async () => {
    const roles = await request().get("/api/v1/roles/summaries").set(auth(tenant.accessToken)).expect(200);
    const superAdmin = roles.body.find((r: { nameEn: string }) => r.nameEn === "Super Admin");

    const patchRes = await request()
      .patch(`/api/v1/roles/${superAdmin.id}`)
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Not Super Admin", nameAr: "ليس مسؤولاً عاماً", permissionKeys: [] })
      .expect(403);
    expect(patchRes.body.code).toBe("ROLE_PROTECTED");

    const deleteRes = await request()
      .delete(`/api/v1/roles/${superAdmin.id}`)
      .set(auth(tenant.accessToken))
      .expect(403);
    expect(deleteRes.body.code).toBe("ROLE_PROTECTED");
  });

  it("blocks deleting a role currently assigned to staff, succeeds after reassignment", async () => {
    const created = await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Temp Role", nameAr: "دور مؤقت", permissionKeys: [] })
      .expect(201);
    const roleId = created.body.id as string;

    const staff = await createUserWithRole(app, tenant.tenantId, "Temp Role", [branchId]);

    const blocked = await request()
      .delete(`/api/v1/roles/${roleId}`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(blocked.body.code).toBe("ROLE_IN_USE");

    const roles = await request().get("/api/v1/roles/summaries").set(auth(tenant.accessToken)).expect(200);
    const barber = roles.body.find((r: { nameEn: string }) => r.nameEn === "Barber");
    await db.user.update({ where: { id: staff.userId }, data: { roleId: barber.id } });

    await request().delete(`/api/v1/roles/${roleId}`).set(auth(tenant.accessToken)).expect(200);
  });

  it("returns 403 without roles.manage, and 404 across tenants", async () => {
    const barberStaff = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);

    const denied = await request()
      .get("/api/v1/roles/summaries")
      .set(auth(barberStaff.accessToken))
      .expect(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");

    const created = await request()
      .post("/api/v1/roles")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Isolation Role", nameAr: "دور معزول", permissionKeys: [] })
      .expect(201);

    await request()
      .get(`/api/v1/roles/${created.body.id}`)
      .set(auth(tenantB.accessToken))
      .expect(404);
  });
});
