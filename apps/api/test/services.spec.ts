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

describe("service catalog", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let branch1Id: string;
  let branch2Id: string;
  let categoryId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const validService = (overrides: object = {}) => ({
    categoryId,
    nameEn: `Haircut ${randomUUID().slice(0, 6)}`,
    nameAr: "قص شعر",
    durationMinutes: 30,
    bufferMinutes: 10,
    priceMinor: 3500, // 3.500 OMR in baisa
    ...overrides,
  });

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);

    for (const name of ["Catalog One", "Catalog Two"]) {
      const res = await request()
        .post("/api/v1/branches")
        .set(auth(tenant.accessToken))
        .send(validBranchPayload(name))
        .expect(201);
      if (name === "Catalog One") branch1Id = res.body.id;
      else branch2Id = res.body.id;
    }

    const cat = await request()
      .post("/api/v1/service-categories")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Hair", nameAr: "الشعر", sortOrder: 1 })
      .expect(201);
    categoryId = cat.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates and lists categories with service counts", async () => {
    const list = await request()
      .get("/api/v1/service-categories")
      .set(auth(tenant.accessToken))
      .expect(200);
    const hair = list.body.find((c: { id: string }) => c.id === categoryId);
    expect(hair.nameAr).toBe("الشعر");
    expect(hair.serviceCount).toBeGreaterThanOrEqual(0);
  });

  it("rejects duplicate category names with NAME_EXISTS", async () => {
    const res = await request()
      .post("/api/v1/service-categories")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Hair", nameAr: "الشعر ٢" })
      .expect(409);
    expect(res.body.code).toBe("NAME_EXISTS");
  });

  it("creates a service with branch overrides and audits it", async () => {
    const res = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(
        validService({
          branchOverrides: [
            { branchId: branch1Id, priceOverrideMinor: 4000, isAvailable: true },
            { branchId: branch2Id, isAvailable: false },
          ],
        }),
      )
      .expect(201);

    expect(res.body.priceMinor).toBe(3500);
    expect(res.body.category.nameEn).toBe("Hair");
    const b1 = res.body.branchOverrides.find((o: { branchId: string }) => o.branchId === branch1Id);
    const b2 = res.body.branchOverrides.find((o: { branchId: string }) => o.branchId === branch2Id);
    expect(b1.priceOverrideMinor).toBe(4000);
    expect(b2.isAvailable).toBe(false);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "service.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();
  });

  it("branchId filter respects availability exceptions", async () => {
    const created = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ branchOverrides: [{ branchId: branch1Id, isAvailable: false }] }))
      .expect(201);

    const atBranch1 = await request()
      .get(`/api/v1/services?branchId=${branch1Id}&pageSize=100`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const atBranch2 = await request()
      .get(`/api/v1/services?branchId=${branch2Id}&pageSize=100`)
      .set(auth(tenant.accessToken))
      .expect(200);

    const ids1 = atBranch1.body.data.map((s: { id: string }) => s.id);
    const ids2 = atBranch2.body.data.map((s: { id: string }) => s.id);
    expect(ids1).not.toContain(created.body.id); // switched off at branch 1
    expect(ids2).toContain(created.body.id); // no exception row → offered
  });

  it("replaces overrides wholesale on update", async () => {
    const created = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(
        validService({ branchOverrides: [{ branchId: branch1Id, priceOverrideMinor: 5000 }] }),
      )
      .expect(201);

    const updated = await request()
      .patch(`/api/v1/services/${created.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ branchOverrides: [{ branchId: branch2Id, priceOverrideMinor: 6000 }] })
      .expect(200);

    expect(updated.body.branchOverrides).toHaveLength(1);
    expect(updated.body.branchOverrides[0].branchId).toBe(branch2Id);
    expect(updated.body.branchOverrides[0].priceOverrideMinor).toBe(6000);
  });

  it("rejects duplicate service names with NAME_EXISTS", async () => {
    const name = `Beard Trim ${randomUUID().slice(0, 6)}`;
    await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ nameEn: name }))
      .expect(201);

    const dup = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ nameEn: name }))
      .expect(409);
    expect(dup.body.code).toBe("NAME_EXISTS");

    // a different tenant may reuse the same name (uniqueness is tenant-scoped)
    const other = await provisionTenant(app);
    const otherCat = await request()
      .post("/api/v1/service-categories")
      .set(auth(other.accessToken))
      .send({ nameEn: "Hair", nameAr: "الشعر" })
      .expect(201);
    await request()
      .post("/api/v1/services")
      .set(auth(other.accessToken))
      .send(validService({ categoryId: otherCat.body.id, nameEn: name }))
      .expect(201);
  });

  it("validates money and duration at the schema boundary", async () => {
    const negative = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ priceMinor: -100 }))
      .expect(400);
    expect(negative.body.code).toBe("VALIDATION_FAILED");

    const fractional = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ priceMinor: 35.5 }))
      .expect(400);
    expect(fractional.body.code).toBe("VALIDATION_FAILED");

    await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(validService({ durationMinutes: 2 }))
      .expect(400);
  });

  it("rejects duplicate branches in overrides", async () => {
    const res = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send(
        validService({
          branchOverrides: [
            { branchId: branch1Id, priceOverrideMinor: 1000 },
            { branchId: branch1Id, isAvailable: false },
          ],
        }),
      )
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("barber can view the catalog but cannot manage it", async () => {
    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", [branch1Id]);
    await request().get("/api/v1/services").set(auth(barber.accessToken)).expect(200);
    const res = await request()
      .post("/api/v1/services")
      .set(auth(barber.accessToken))
      .send(validService())
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");

    const cat = await request()
      .post("/api/v1/service-categories")
      .set(auth(barber.accessToken))
      .send({ nameEn: "Nope", nameAr: "لا" })
      .expect(403);
    expect(cat.body.code).toBe("PERMISSION_DENIED");
  });

  it("cross-tenant: another tenant sees nothing and cannot use foreign ids", async () => {
    const other = await provisionTenant(app);

    const list = await request()
      .get("/api/v1/services?pageSize=100")
      .set(auth(other.accessToken))
      .expect(200);
    expect(list.body.meta.total).toBe(0);

    const cats = await request()
      .get("/api/v1/service-categories")
      .set(auth(other.accessToken))
      .expect(200);
    expect(cats.body).toHaveLength(0);

    // foreign categoryId is invisible under RLS → validation failure, not a leak
    const res = await request()
      .post("/api/v1/services")
      .set(auth(other.accessToken))
      .send(validService())
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });
});
