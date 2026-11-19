import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, createUserWithRole, type TestAdmin } from "./helpers";

describe("settings > company info", () => {
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

  it("reads and updates the singleton company profile", async () => {
    const name = `Keystone HR ${randomUUID().slice(0, 6)}`;
    const updated = await request()
      .patch("/api/v1/settings/company")
      .set(auth(admin.accessToken))
      .send({
        name,
        contactPhone: "+971 4 123 4567",
        contactEmail: "info@example.com",
        address: "Business Bay, Dubai, UAE",
        taxNumber: "AE-VAT-123",
        commercialRegistrationNo: "CR-456",
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      name,
      contactPhone: "+971 4 123 4567",
      contactEmail: "info@example.com",
      address: "Business Bay, Dubai, UAE",
      taxNumber: "AE-VAT-123",
      commercialRegistrationNo: "CR-456",
    });

    const fetched = await request()
      .get("/api/v1/settings/company")
      .set(auth(admin.accessToken))
      .expect(200);
    expect(fetched.body.name).toBe(name);
  });

  it("denies a role without settings.company.manage", async () => {
    const branchManager = await createUserWithRole(app, "Branch Manager", []);

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
