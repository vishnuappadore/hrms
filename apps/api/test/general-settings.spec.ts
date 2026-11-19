import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, createUserWithRole, type TestAdmin } from "./helpers";

describe("settings > general settings", () => {
  let app: INestApplication;
  let admin: TestAdmin;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    admin = await createTestAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("reads and updates the singleton general settings", async () => {
    const fetched = await request()
      .get("/api/v1/settings/general")
      .set(auth(admin.accessToken))
      .expect(200);
    expect(fetched.body.defaultCurrency).toBe("AED");
    expect(typeof fetched.body.branchCount).toBe("number");

    const updated = await request()
      .patch("/api/v1/settings/general")
      .set(auth(admin.accessToken))
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

    // restore so later/parallel assertions about the default locale elsewhere aren't affected
    await request()
      .patch("/api/v1/settings/general")
      .set(auth(admin.accessToken))
      .send({
        defaultLocale: "en",
        timezone: "Asia/Dubai",
        defaultCurrency: "AED",
        useWesternNumeralsInArabic: true,
        weekStartsOn: "monday",
      })
      .expect(200);
  });

  it("denies a role without settings.general.manage", async () => {
    const branchManager = await createUserWithRole(app, "Branch Manager", []);

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
        timezone: "Asia/Dubai",
        defaultCurrency: "AED",
        useWesternNumeralsInArabic: true,
        weekStartsOn: "monday",
      })
      .expect(403);
    expect(patchDenied.body.code).toBe("PERMISSION_DENIED");
  });
});
