import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createUserWithRole,
  provisionTenant,
  validCustomerPayload,
  type TestTenant,
} from "./helpers";

describe("customers", () => {
  let app: INestApplication;
  let tenant: TestTenant;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("presigns a profile-photo upload URL", async () => {
    const res = await request()
      .post("/api/v1/customers/photo-upload-url")
      .set(auth(tenant.accessToken))
      .send({ fileName: "photo.jpg", contentType: "image/jpeg" })
      .expect(201);

    expect(res.body.uploadUrl).toMatch(/^https?:\/\//);
    expect(res.body.key).toContain(`tenants/${tenant.tenantId}/customer-photo/`);
    expect(res.body.key).toContain("photo.jpg");
  });

  it("creates a customer, defaults tier to 'new', and audits it", async () => {
    const res = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ name: "Layla Said" }))
      .expect(201);

    expect(res.body.tier).toBe("new");
    expect(res.body.visits).toBe(0);
    expect(res.body.points).toBe(0);
    expect(res.body.totalSpendMinor).toBe(0);
    expect(res.body.currency).toBe("OMR");
    expect(res.body.name).toBe("Layla Said");

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "customer.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();
  });

  it("accepts an explicit tier at creation", async () => {
    const res = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ tier: "gold" }))
      .expect(201);
    expect(res.body.tier).toBe("gold");
  });

  it("rejects a duplicate mobile with CUSTOMER_MOBILE_EXISTS", async () => {
    const mobile = validCustomerPayload().mobile;
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ mobile }))
      .expect(201);

    const dup = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ mobile }))
      .expect(409);
    expect(dup.body.code).toBe("CUSTOMER_MOBILE_EXISTS");

    // a different tenant may reuse the same mobile (uniqueness is tenant-scoped)
    const other = await provisionTenant(app);
    await request()
      .post("/api/v1/customers")
      .set(auth(other.accessToken))
      .send(validCustomerPayload({ mobile }))
      .expect(201);
  });

  it("rejects a duplicate email with CUSTOMER_EMAIL_EXISTS, but allows multiple customers with no email", async () => {
    const email = `dup-${randomUUID().slice(0, 8)}@test.hayryou`;
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ email }))
      .expect(201);

    const dup = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ email }))
      .expect(409);
    expect(dup.body.code).toBe("CUSTOMER_EMAIL_EXISTS");

    // two customers with no email at all is fine — uniqueness only applies to a provided email
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ email: null }))
      .expect(201);
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ email: null }))
      .expect(201);

    // a different tenant may reuse the same email (uniqueness is tenant-scoped)
    const other = await provisionTenant(app);
    await request()
      .post("/api/v1/customers")
      .set(auth(other.accessToken))
      .send(validCustomerPayload({ email }))
      .expect(201);
  });

  it("blocks an email collision on update", async () => {
    const a = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload())
      .expect(201);
    const bEmail = `b-${randomUUID().slice(0, 8)}@test.hayryou`;
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ email: bEmail }))
      .expect(201);

    const clash = await request()
      .patch(`/api/v1/customers/${a.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ email: bEmail })
      .expect(409);
    expect(clash.body.code).toBe("CUSTOMER_EMAIL_EXISTS");
  });

  it("edits name, email, and tier; blocks a mobile collision on update", async () => {
    const a = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload())
      .expect(201);
    const b = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload())
      .expect(201);

    const updated = await request()
      .patch(`/api/v1/customers/${a.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ name: "Renamed", email: "renamed@test.hayryou", tier: "silver" })
      .expect(200);
    expect(updated.body.name).toBe("Renamed");
    expect(updated.body.email).toBe("renamed@test.hayryou");
    expect(updated.body.tier).toBe("silver");

    // moving A onto B's mobile is rejected
    const clash = await request()
      .patch(`/api/v1/customers/${a.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ mobile: b.body.mobile })
      .expect(409);
    expect(clash.body.code).toBe("CUSTOMER_MOBILE_EXISTS");
  });

  it("searches by name and mobile, and filters by tier", async () => {
    const mobile = validCustomerPayload().mobile;
    await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ name: "Zainab Unique", mobile, tier: "platinum" }))
      .expect(201);

    const byName = await request()
      .get("/api/v1/customers?search=Zainab%20Unique&pageSize=100")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(byName.body.data.some((c: { name: string }) => c.name === "Zainab Unique")).toBe(true);

    const byMobile = await request()
      .get(`/api/v1/customers?search=${encodeURIComponent(mobile)}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(byMobile.body.data.some((c: { mobile: string }) => c.mobile === mobile)).toBe(true);

    const platinum = await request()
      .get("/api/v1/customers?tier=platinum&pageSize=100")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(platinum.body.data.every((c: { tier: string }) => c.tier === "platinum")).toBe(true);
  });

  it("returns NOT_FOUND for an unknown id and rejects an invalid mobile", async () => {
    const missing = await request()
      .get(`/api/v1/customers/${randomUUID()}`)
      .set(auth(tenant.accessToken))
      .expect(404);
    expect(missing.body.code).toBe("NOT_FOUND");

    const bad = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload({ mobile: "not-a-number" }))
      .expect(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });

  it("a Barber (customers.view only) cannot create a customer", async () => {
    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", []);
    await request().get("/api/v1/customers").set(auth(barber.accessToken)).expect(200);
    const res = await request()
      .post("/api/v1/customers")
      .set(auth(barber.accessToken))
      .send(validCustomerPayload())
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("cross-tenant: another tenant sees none of these customers and cannot fetch a foreign id", async () => {
    const mine = await request()
      .post("/api/v1/customers")
      .set(auth(tenant.accessToken))
      .send(validCustomerPayload())
      .expect(201);

    const other = await provisionTenant(app);
    const list = await request()
      .get("/api/v1/customers?pageSize=100")
      .set(auth(other.accessToken))
      .expect(200);
    expect(list.body.data.every((c: { id: string }) => c.id !== mine.body.id)).toBe(true);

    // foreign id is invisible under RLS → NOT_FOUND, not a leak
    const foreign = await request()
      .get(`/api/v1/customers/${mine.body.id}`)
      .set(auth(other.accessToken))
      .expect(404);
    expect(foreign.body.code).toBe("NOT_FOUND");
  });
});
