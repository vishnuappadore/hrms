import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createUserWithRole, provisionTenant, type TestTenant } from "./helpers";

describe("settings > company info", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let tenantB: TestTenant;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("reads and updates the caller's own tenant profile", async () => {
    const name = `Acme Salon ${randomUUID().slice(0, 6)}`;
    const updated = await request()
      .patch("/api/v1/settings/company")
      .set(auth(tenant.accessToken))
      .send({
        name,
        contactPhone: "+968 1234 5678",
        contactEmail: "info@example.com",
        address: "Muscat, Oman",
        taxNumber: "OM-VAT-123",
        commercialRegistrationNo: "CR-456",
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      name,
      contactPhone: "+968 1234 5678",
      contactEmail: "info@example.com",
      address: "Muscat, Oman",
      taxNumber: "OM-VAT-123",
      commercialRegistrationNo: "CR-456",
    });

    const fetched = await request()
      .get("/api/v1/settings/company")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(fetched.body.name).toBe(name);
  });

  it("tenant B never sees tenant A's company profile", async () => {
    const name = `Only Tenant A ${randomUUID().slice(0, 6)}`;
    await request()
      .patch("/api/v1/settings/company")
      .set(auth(tenant.accessToken))
      .send({ name })
      .expect(200);

    const fetchedB = await request()
      .get("/api/v1/settings/company")
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(fetchedB.body.name).not.toBe(name);
  });

  it("denies a role without settings.company.manage", async () => {
    const branchManager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", []);

    const getDenied = await request()
      .get("/api/v1/settings/company")
      .set(auth(branchManager.accessToken))
      .expect(403);
    expect(getDenied.body.code).toBe("PERMISSION_DENIED");

    const patchDenied = await request()
      .patch("/api/v1/settings/company")
      .set(auth(branchManager.accessToken))
      .send({ name: "Should not apply" })
      .expect(403);
    expect(patchDenied.body.code).toBe("PERMISSION_DENIED");
  });
});
