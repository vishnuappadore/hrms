import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createUserWithRole,
  provisionTenant,
  validBranchPayload,
  type TestTenant,
} from "./helpers";

describe("settings > general settings", () => {
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

  it("reads and updates the caller's own general settings", async () => {
    const fetched = await request()
      .get("/api/v1/settings/general")
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(fetched.body).toMatchObject({
      defaultCurrency: "OMR",
      useWesternNumeralsInArabic: true,
      weekStartsOn: "sunday",
      branchCount: 0,
    });

    const updated = await request()
      .patch("/api/v1/settings/general")
      .set(auth(tenant.accessToken))
      .send({
        defaultLocale: "ar",
        timezone: "Asia/Dubai",
        defaultCurrency: "AED",
        useWesternNumeralsInArabic: false,
        weekStartsOn: "monday",
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      defaultLocale: "ar",
      timezone: "Asia/Dubai",
      defaultCurrency: "AED",
      useWesternNumeralsInArabic: false,
      weekStartsOn: "monday",
    });
  });

  it("locks defaultCurrency once the tenant has a branch", async () => {
    await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("General Settings Currency Lock Branch"))
      .expect(201);

    const denied = await request()
      .patch("/api/v1/settings/general")
      .set(auth(tenant.accessToken))
      .send({
        defaultLocale: "en",
        timezone: "Asia/Muscat",
        defaultCurrency: "USD",
        useWesternNumeralsInArabic: true,
        weekStartsOn: "sunday",
      })
      .expect(409);
    expect(denied.body.code).toBe("TENANT_CURRENCY_LOCKED");

    // Same-currency update (not actually changing it) is still allowed.
    await request()
      .patch("/api/v1/settings/general")
      .set(auth(tenant.accessToken))
      .send({
        defaultLocale: "en",
        timezone: "Asia/Muscat",
        defaultCurrency: "AED",
        useWesternNumeralsInArabic: true,
        weekStartsOn: "sunday",
      })
      .expect(200);
  });

  it("tenant B never sees tenant A's general settings", async () => {
    const fetchedB = await request()
      .get("/api/v1/settings/general")
      .set(auth(tenantB.accessToken))
      .expect(200);
    expect(fetchedB.body.defaultCurrency).toBe("OMR");
    expect(fetchedB.body.branchCount).toBe(0);
  });

  it("denies a role without settings.general.manage", async () => {
    const branchManager = await createUserWithRole(app, tenantB.tenantId, "Branch Manager", []);

    const getDenied = await request()
      .get("/api/v1/settings/general")
      .set(auth(branchManager.accessToken))
      .expect(403);
    expect(getDenied.body.code).toBe("PERMISSION_DENIED");

    const patchDenied = await request()
      .patch("/api/v1/settings/general")
      .set(auth(branchManager.accessToken))
      .send({
        defaultLocale: "en",
        timezone: "Asia/Muscat",
        defaultCurrency: "OMR",
        useWesternNumeralsInArabic: true,
        weekStartsOn: "sunday",
      })
      .expect(403);
    expect(patchDenied.body.code).toBe("PERMISSION_DENIED");
  });
});
