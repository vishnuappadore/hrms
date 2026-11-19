import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as argon2 from "argon2";
import { AuthPrismaService } from "../src/database/auth-prisma.service";
import {
  createApp,
  createUserWithRole,
  provisionTenant,
  validBranchPayload,
  type TestTenant,
} from "./helpers";

describe("dashboard", () => {
  let app: INestApplication;
  let db: AuthPrismaService;
  let tenant: TestTenant;
  let tenantB: TestTenant;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(AuthPrismaService);
    tenant = await provisionTenant(app);
    tenantB = await provisionTenant(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("omits sections per-permission rather than denying the whole page", async () => {
    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", []);

    const res = await request().get("/api/v1/dashboard").set(auth(barber.accessToken)).expect(200);
    // Barber has appointments.view but neither pos.use nor invoices.view nor inventory.view.
    expect(res.body.appointmentsToday).toBeDefined();
    expect(res.body.revenueToday).toBeUndefined();
    expect(res.body.lowStockAlerts).toBeUndefined();
  });

  it("denies the whole page for a role with no dashboard.view", async () => {
    const role = await db.role.create({
      data: {
        tenantId: tenant.tenantId,
        nameEn: `No Dashboard ${randomUUID().slice(0, 6)}`,
        nameAr: "بدون لوحة",
        isSystem: false,
      },
    });
    const password = "Test@12345";
    const user = await db.user.create({
      data: {
        tenantId: tenant.tenantId,
        name: "No Dashboard User",
        email: `no-dashboard-${randomUUID().slice(0, 8)}@test.hayryou`,
        username: `no-dashboard-${randomUUID().slice(0, 8)}`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        roleId: role.id,
        allBranches: true,
      },
    });
    const login = await request()
      .post("/api/v1/auth/login")
      .send({ identifier: user.email, password })
      .expect(200);

    const res = await request()
      .get("/api/v1/dashboard")
      .set(auth(login.body.tokens.accessToken))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("tenant B never sees tenant A's revenue", async () => {
    const branchA = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Dashboard Tenant A Branch"))
      .expect(201);
    const branchB = await request()
      .post("/api/v1/branches")
      .set(auth(tenantB.accessToken))
      .send(validBranchPayload("Dashboard Tenant B Branch"))
      .expect(201);

    await db.financeTransaction.create({
      data: {
        tenantId: tenant.tenantId,
        branchId: branchA.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 50_000n,
        currency: "OMR",
        occurredAt: new Date(),
      },
    });
    await db.financeTransaction.create({
      data: {
        tenantId: tenantB.tenantId,
        branchId: branchB.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 99_000n,
        currency: "OMR",
        occurredAt: new Date(),
      },
    });

    const resA = await request().get("/api/v1/dashboard").set(auth(tenant.accessToken)).expect(200);
    const omrA = resA.body.revenueToday.byCurrency.find((c: { currency: string }) => c.currency === "OMR");
    expect(omrA?.amountMinor).toBe(50_000);
    expect(omrA?.amountMinor).not.toBe(99_000 + 50_000);
  });

  it("scopes a Branch Manager to only their assigned branch, and rejects a branchId override outside it", async () => {
    const branchX = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Dashboard Scope Branch X"))
      .expect(201);
    const branchY = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Dashboard Scope Branch Y"))
      .expect(201);

    await db.financeTransaction.create({
      data: {
        tenantId: tenant.tenantId,
        branchId: branchX.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 10_000n,
        currency: "OMR",
        occurredAt: new Date(),
      },
    });
    await db.financeTransaction.create({
      data: {
        tenantId: tenant.tenantId,
        branchId: branchY.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 70_000n,
        currency: "OMR",
        occurredAt: new Date(),
      },
    });

    const manager = await createUserWithRole(app, tenant.tenantId, "Branch Manager", [branchX.body.id]);

    const res = await request().get("/api/v1/dashboard").set(auth(manager.accessToken)).expect(200);
    const omr = res.body.revenueToday.byCurrency.find((c: { currency: string }) => c.currency === "OMR");
    expect(omr?.amountMinor).toBe(10_000);

    const denied = await request()
      .get(`/api/v1/dashboard?branchId=${branchY.body.id}`)
      .set(auth(manager.accessToken))
      .expect(403);
    expect(denied.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("never blends revenue across branches reporting in different currencies", async () => {
    const omrBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenantB.accessToken))
      .send(validBranchPayload("Currency Safety OMR Branch"))
      .expect(201);
    const usdBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenantB.accessToken))
      .send({ ...validBranchPayload("Currency Safety USD Branch"), currency: "USD" })
      .expect(201);
    expect(omrBranch.body.currency).toBe("OMR");
    expect(usdBranch.body.currency).toBe("USD");

    await db.financeTransaction.create({
      data: {
        tenantId: tenantB.tenantId,
        branchId: omrBranch.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 20_000n,
        currency: "OMR",
        occurredAt: new Date(),
      },
    });
    await db.financeTransaction.create({
      data: {
        tenantId: tenantB.tenantId,
        branchId: usdBranch.body.id,
        direction: "in",
        category: "sale_revenue",
        amountMinor: 30_000n,
        currency: "USD",
        occurredAt: new Date(),
      },
    });

    const res = await request().get("/api/v1/dashboard").set(auth(tenantB.accessToken)).expect(200);
    const byCurrency: { currency: string; amountMinor: number }[] = res.body.revenueToday.byCurrency;
    // Only count what THIS test contributed — tenantB may carry revenue from the isolation test too.
    const omr = byCurrency.find((c) => c.currency === "OMR");
    const usd = byCurrency.find((c) => c.currency === "USD");
    expect(omr).toBeDefined();
    expect(usd).toBeDefined();
    expect(usd?.amountMinor).toBe(30_000);
    expect(byCurrency.some((c) => c.amountMinor === 20_000 + 30_000)).toBe(false);
  });
});
