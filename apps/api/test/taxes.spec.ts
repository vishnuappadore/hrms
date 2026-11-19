import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createUserWithRole, provisionTenant, validBranchPayload, type TestTenant } from "./helpers";

describe("tax profiles (DB-configured, per tenant)", () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant provisioning seeds a default profile", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/tax-profiles")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    const def = res.body.data.find((p: { isDefault: boolean }) => p.isDefault);
    expect(def).toBeTruthy();
    expect(def.components).toEqual([
      expect.objectContaining({ name: "VAT", ratePercent: "5", sortOrder: 0 }),
    ]);
  });

  it("a branch created without a profile inherits the tenant default", async () => {
    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send(validBranchPayload("Default Tax Branch"))
      .expect(201);

    const branch = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(branch.body.taxProfile.isDefault).toBe(true);
    expect(branch.body.taxProfile.components[0].name).toBe("VAT");
  });

  it("supports multi-component profiles (India GST) assigned to a branch", async () => {
    const profile = await supertest(app.getHttpServer())
      .post("/api/v1/tax-profiles")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({
        name: "India GST 18% (intra-state)",
        country: "IN",
        components: [
          { name: "CGST", ratePercent: 9 },
          { name: "SGST", ratePercent: 9 },
        ],
      })
      .expect(201);
    expect(profile.body.components).toHaveLength(2);

    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ ...validBranchPayload("Bangalore Branch"), taxProfileId: profile.body.id })
      .expect(201);

    const branch = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(branch.body.taxProfile.name).toBe("India GST 18% (intra-state)");
    expect(branch.body.taxProfile.components.map((c: { name: string }) => c.name)).toEqual([
      "CGST",
      "SGST",
    ]);
  });

  it("explicit null taxProfileId creates a tax-free branch", async () => {
    const created = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .send({ ...validBranchPayload("Tax Free Branch"), taxProfileId: null })
      .expect(201);
    const branch = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${created.body.id}`)
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(branch.body.taxProfile).toBeNull();
  });

  it("tax profiles are tenant-isolated", async () => {
    const other = await provisionTenant(app);
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/tax-profiles")
      .set("Authorization", `Bearer ${other.accessToken}`)
      .expect(200);
    // other tenant sees only its own seeded default, not this tenant's India GST
    const names = res.body.data.map((p: { name: string }) => p.name);
    expect(names).not.toContain("India GST 18% (intra-state)");
  });

  it("managing profiles requires taxes.manage (barber gets 403)", async () => {
    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", []);
    await supertest(app.getHttpServer())
      .post("/api/v1/tax-profiles")
      .set("Authorization", `Bearer ${barber.accessToken}`)
      .send({ name: "Nope", components: [{ name: "X", ratePercent: 1 }] })
      .expect(403);
  });
});
