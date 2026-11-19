import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createTestAdmin, createUserWithRole, type TestAdmin } from "./helpers";

describe("payroll components", () => {
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

  it("bulk-saves a section: creates, updates by id, and deactivates rows omitted from the payload", async () => {
    const nameEn = `Housing ${randomUUID().slice(0, 6)}`;
    const created = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(admin.accessToken))
      .send({
        items: [
          { nameEn, nameAr: "سكن", basis: "fixed_amount", defaultAmountMinor: 50000 },
          { nameEn: `Transport ${randomUUID().slice(0, 6)}`, nameAr: "نقل", basis: "fixed_amount", defaultAmountMinor: 40000 },
        ],
      })
      .expect(200);
    expect(created.body).toHaveLength(2);
    const housingId = created.body.find((c: { nameEn: string }) => c.nameEn === nameEn).id;

    // Second save: update the housing row, drop the transport row entirely.
    const resaved = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(admin.accessToken))
      .send({
        items: [
          { id: housingId, nameEn, nameAr: "سكن", basis: "percentage_of_base", defaultRatePct: 10 },
        ],
      })
      .expect(200);
    expect(resaved.body).toHaveLength(1);
    expect(resaved.body[0].basis).toBe("percentage_of_base");
    expect(resaved.body[0].defaultRatePct).toBe(10);

    const list = await request()
      .get("/api/v1/payroll-components?category=allowance")
      .set(auth(admin.accessToken))
      .expect(200);
    const names = list.body.map((c: { nameEn: string }) => c.nameEn);
    expect(names).toContain(nameEn);
    expect(names.filter((n: string) => n.startsWith("Transport"))).toHaveLength(0);
  });

  it("rejects a duplicate name with NAME_EXISTS", async () => {
    const nameEn = `Meal ${randomUUID().slice(0, 6)}`;
    await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(admin.accessToken))
      .send({ items: [{ nameEn, nameAr: "وجبة", basis: "fixed_amount", defaultAmountMinor: 10000 }] })
      .expect(200);

    const dup = await request()
      .put("/api/v1/payroll-components?category=deduction")
      .set(auth(admin.accessToken))
      .send({ items: [{ nameEn, nameAr: "وجبة", basis: "fixed_amount", defaultAmountMinor: 5000 }] })
      .expect(409);
    expect(dup.body.code).toBe("NAME_EXISTS");
  });

  it("employee.view can list but settings.manage is required to save", async () => {
    const branchManager = await createUserWithRole(app, "Branch Manager", []);

    await request()
      .get("/api/v1/payroll-components?category=allowance")
      .set(auth(branchManager.accessToken))
      .expect(200);

    const denied = await request()
      .put("/api/v1/payroll-components?category=allowance")
      .set(auth(branchManager.accessToken))
      .send({ items: [{ nameEn: "X", nameAr: "س", basis: "fixed_amount", defaultAmountMinor: 0 }] })
      .expect(403);
    expect(denied.body.code).toBe("PERMISSION_DENIED");
  });

  it("denies listing to roles without employee.view", async () => {
    const employeeUser = await createUserWithRole(app, "Employee", []);
    const res = await request()
      .get("/api/v1/payroll-components?category=allowance")
      .set(auth(employeeUser.accessToken))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });
});
