import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, provisionTenant, type TestTenant } from "./helpers";

describe("auth", () => {
  let app: INestApplication;
  let tenant: TestTenant;

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("logs in with email and returns tokens + user", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identifier: tenant.adminEmail, password: tenant.password })
      .expect(200);
    expect(res.body.tokens.accessToken).toBeTruthy();
    expect(res.body.tokens.refreshToken).toBeTruthy();
    expect(res.body.user.allBranches).toBe(true);
    expect(res.body.user.roleNameEn).toBe("Super Admin");
    // Super Admin's role was seeded with every catalog key ("*") — spot-check a few.
    expect(res.body.user.permissions).toContain("roles.manage");
    expect(res.body.user.permissions).toContain("payroll.view");
  });

  it("rejects wrong password with stable error code", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identifier: tenant.adminEmail, password: "wrong-password" })
      .expect(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("validates empty fields with VALIDATION_FAILED", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identifier: "", password: "" })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rotates refresh tokens: old refresh token becomes invalid", async () => {
    const login = await supertest(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ identifier: tenant.adminEmail, password: tenant.password })
      .expect(200);
    const firstRefresh = login.body.tokens.refreshToken;

    const refreshed = await supertest(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // replaying the consumed token must fail
    await supertest(app.getHttpServer())
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: firstRefresh })
      .expect(401);
  });

  it("rejects protected routes without a token", async () => {
    await supertest(app.getHttpServer()).get("/api/v1/branches").expect(401);
  });

  it("serves /users/me for the authenticated user", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${tenant.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(tenant.adminEmail);
  });
});
