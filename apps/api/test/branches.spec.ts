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

describe("branches + branch scoping", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let branch1Id: string;
  let branch2Id: string;

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);

    const b1 = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send(validBranchPayload("Scoped One"))
      .expect(201);
    branch1Id = b1.body.id;

    const b2 = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send(validBranchPayload("Scoped Two"))
      .expect(201);
    branch2Id = b2.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("generates sequential immutable store codes", async () => {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(res.body.code).toMatch(/^BR-\d{4}$/);
  });

  it("requires franchise details when type is franchise", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ ...validBranchPayload("Franchise Missing Details"), type: "franchise" })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("branch manager sees only assigned branches in list", async () => {
    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(200);
    const ids = res.body.data.map((b: { id: string }) => b.id);
    expect(ids).toContain(branch1Id);
    expect(ids).not.toContain(branch2Id);
  });

  it("branch manager gets 403 on an unassigned branch", async () => {
    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch2Id}`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("receptionist (no branches.create) gets 403 creating a branch", async () => {
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${receptionist.accessToken}`)
      .send(validBranchPayload("Should Fail"))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("one franchise owner can hold multiple branches", async () => {
    const agreement = {
      agreementStartDate: "2026-01-01",
      agreementExpiryDate: "2031-01-01",
    };
    // first franchise branch creates the owner inline
    const first = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        ...validBranchPayload("Franchise One"),
        type: "franchise",
        franchiseDetails: {
          ...agreement,
          newOwner: {
            ownerName: "Multi Owner",
            companyName: "Multi Branch LLC",
            commercialRegistrationNo: `CR-${Date.now()}`,
          },
        },
      })
      .expect(201);
    const ownerId = first.body.franchiseDetails.franchiseOwnerId;

    // second branch reuses the existing owner by id
    await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        ...validBranchPayload("Franchise Two"),
        type: "franchise",
        franchiseDetails: { ...agreement, franchiseOwnerId: ownerId },
      })
      .expect(201);

    // list filter returns exactly this owner's branches
    const list = await supertest(app.getHttpServer())
      .get(`/api/v1/branches?franchiseOwnerId=${ownerId}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(list.body.meta.total).toBe(2);
    const names = list.body.data.map((b: { nameEn: string }) => b.nameEn).sort();
    expect(names).toEqual(["Franchise One", "Franchise Two"]);
  });

  it("rejects franchise details with both ownerId and newOwner", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        ...validBranchPayload("Bad Franchise"),
        type: "franchise",
        franchiseDetails: {
          agreementStartDate: "2026-01-01",
          agreementExpiryDate: "2031-01-01",
          franchiseOwnerId: "00000000-0000-0000-0000-000000000000",
          newOwner: {
            ownerName: "X",
            companyName: "Y",
            commercialRegistrationNo: "Z",
          },
        },
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("stats KPIs are branch-scoped", async () => {
    // admin (all branches) sees the tenant-wide counts
    const adminStats = await supertest(app.getHttpServer())
      .get("/api/v1/branches/stats")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(adminStats.body.total).toBeGreaterThanOrEqual(2);
    expect(adminStats.body.total).toBe(adminStats.body.active + adminStats.body.inactive);

    // a manager assigned to one branch sees exactly that slice
    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branch1Id]);
    const scoped = await supertest(app.getHttpServer())
      .get("/api/v1/branches/stats")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(scoped.body.total).toBe(1);
    expect(scoped.body.staff).toBeGreaterThanOrEqual(1); // at least the manager themself
  });

  it("creates a branch with chairCount and serviceIds, reflected on read", async () => {
    const category = await supertest(app.getHttpServer())
      .post("/api/v1/service-categories")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ nameEn: `Cat ${randomUUID().slice(0, 6)}`, nameAr: "فئة" })
      .expect(201);

    const serviceOn = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Cut ${randomUUID().slice(0, 6)}`,
        nameAr: "قص",
        durationMinutes: 30,
        priceMinor: 1000,
      })
      .expect(201);

    const serviceOff = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Color ${randomUUID().slice(0, 6)}`,
        nameAr: "صبغة",
        durationMinutes: 60,
        priceMinor: 5000,
      })
      .expect(201);

    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        ...validBranchPayload("Capacity Branch"),
        chairCount: 5,
        serviceIds: [serviceOn.body.id],
      })
      .expect(201);
    expect(created.body.chairCount).toBe(5);

    const detail = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(detail.body.chairCount).toBe(5);
    const bs = detail.body.branchServices as { serviceId: string; isAvailable: boolean }[];
    // Selected service: no exception row needed, offered at base price.
    expect(bs.find((r) => r.serviceId === serviceOn.body.id)).toBeUndefined();
    // Deselected service: an explicit isAvailable:false exception row.
    expect(bs.find((r) => r.serviceId === serviceOff.body.id)?.isAvailable).toBe(false);
  });

  it("omitting serviceIds on create leaves the default catalog untouched", async () => {
    // A branch created without serviceIds must NOT switch off pre-existing
    // active services — omitted means "don't touch", same as on update.
    const category = await supertest(app.getHttpServer())
      .post("/api/v1/service-categories")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ nameEn: `Cat ${randomUUID().slice(0, 6)}`, nameAr: "فئة" })
      .expect(201);
    const service = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Wash ${randomUUID().slice(0, 6)}`,
        nameAr: "غسيل",
        durationMinutes: 15,
        priceMinor: 500,
      })
      .expect(201);

    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send(validBranchPayload("No ServiceIds Branch"))
      .expect(201);
    expect(created.body.chairCount).toBe(1); // schema/DB default

    const detail = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const bs = detail.body.branchServices as { serviceId: string; isAvailable: boolean }[];
    expect(bs.find((r) => r.serviceId === service.body.id)).toBeUndefined();
  });

  it("branch-side service toggle never clobbers price overrides or other branches' rows", async () => {
    const category = await supertest(app.getHttpServer())
      .post("/api/v1/service-categories")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ nameEn: `Cat ${randomUUID().slice(0, 6)}`, nameAr: "فئة" })
      .expect(201);

    const svcKeep = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Keep ${randomUUID().slice(0, 6)}`,
        nameAr: "احتفاظ",
        durationMinutes: 30,
        priceMinor: 2000,
      })
      .expect(201);

    const svcToggle = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Toggle ${randomUUID().slice(0, 6)}`,
        nameAr: "تبديل",
        durationMinutes: 30,
        priceMinor: 2000,
      })
      .expect(201);

    // Set a price override for svcKeep at branch1 via the Services module.
    await supertest(app.getHttpServer())
      .patch(`/api/v1/services/${svcKeep.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ branchOverrides: [{ branchId: branch1Id, priceOverrideMinor: 9999, isAvailable: true }] })
      .expect(200);

    // Switch svcToggle off at branch2 via the Services module (independent row).
    await supertest(app.getHttpServer())
      .patch(`/api/v1/services/${svcToggle.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ branchOverrides: [{ branchId: branch2Id, isAvailable: false }] })
      .expect(200);

    // Branch-side wizard on branch1: keep svcKeep selected, deselect svcToggle.
    await supertest(app.getHttpServer())
      .patch(`/api/v1/branches/${branch1Id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ serviceIds: [svcKeep.body.id] })
      .expect(200);

    const detail1 = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const bs1 = detail1.body.branchServices as { serviceId: string; isAvailable: boolean }[];
    expect(bs1.find((r) => r.serviceId === svcKeep.body.id)?.isAvailable).toBe(true);
    expect(bs1.find((r) => r.serviceId === svcToggle.body.id)?.isAvailable).toBe(false);

    // The price override set via the Services module must survive untouched.
    const svcKeepDetail = await supertest(app.getHttpServer())
      .get(`/api/v1/services/${svcKeep.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const override = svcKeepDetail.body.branchOverrides.find(
      (o: { branchId: string }) => o.branchId === branch1Id,
    );
    expect(override.priceOverrideMinor).toBe(9999);

    // branch2's independent exception row for svcToggle must be untouched.
    const detail2 = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch2Id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const bs2 = detail2.body.branchServices as { serviceId: string; isAvailable: boolean }[];
    expect(bs2.find((r) => r.serviceId === svcToggle.body.id)?.isAvailable).toBe(false);
  });

  it("re-selecting a service on a branch restores availability", async () => {
    const category = await supertest(app.getHttpServer())
      .post("/api/v1/service-categories")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ nameEn: `Cat ${randomUUID().slice(0, 6)}`, nameAr: "فئة" })
      .expect(201);
    const service = await supertest(app.getHttpServer())
      .post("/api/v1/services")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        categoryId: category.body.id,
        nameEn: `Restore ${randomUUID().slice(0, 6)}`,
        nameAr: "استعادة",
        durationMinutes: 30,
        priceMinor: 1500,
      })
      .expect(201);

    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ ...validBranchPayload("Restore Branch"), serviceIds: [] })
      .expect(201);

    let detail = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(
      (detail.body.branchServices as { serviceId: string; isAvailable: boolean }[]).find(
        (r) => r.serviceId === service.body.id,
      )?.isAvailable,
    ).toBe(false);

    await supertest(app.getHttpServer())
      .patch(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ serviceIds: [service.body.id] })
      .expect(200);

    detail = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(
      (detail.body.branchServices as { serviceId: string; isAvailable: boolean }[]).find(
        (r) => r.serviceId === service.body.id,
      )?.isAvailable,
    ).toBe(true);
  });

  it("list response includes chairCount per branch", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const found = res.body.data.find((b: { id: string }) => b.id === branch1Id);
    expect(typeof found.chairCount).toBe("number");
  });

  it("audit log records branch creation", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send(validBranchPayload("Audited Branch"))
      .expect(201);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "branch.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();
  });
});
