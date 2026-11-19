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

describe("walk-in queue", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let branchId: string;
  let serviceId: string;
  let secondServiceId: string;
  let barberId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Walk-in Branch"))
      .expect(201);
    branchId = branch.body.id;

    const category = await request()
      .post("/api/v1/service-categories")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Hair", nameAr: "شعر" })
      .expect(201);
    const service = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send({
        categoryId: category.body.id,
        nameEn: "Haircut",
        nameAr: "قص شعر",
        durationMinutes: 30,
        priceMinor: 6000,
      })
      .expect(201);
    serviceId = service.body.id;

    const secondService = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send({
        categoryId: category.body.id,
        nameEn: "Beard Trim",
        nameAr: "تهذيب اللحية",
        durationMinutes: 15,
        priceMinor: 2500,
      })
      .expect(201);
    secondServiceId = secondService.body.id;

    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    barberId = barber.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers a walk-in: snapshots the total, creates+links the customer, audits it", async () => {
    const mobile = `+968${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const res = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId], mobileNumber: mobile, customerName: "Walk In Person" })
      .expect(201);

    expect(res.body.status).toBe("waiting");
    expect(res.body.totalMinor).toBe(6000);
    expect(res.body.currency).toBe("OMR");
    expect(res.body.services).toHaveLength(1);
    expect(res.body.customer.mobile).toBe(mobile);
    expect(res.body.customerName).toBe("Walk In Person");

    const found = await request()
      .get(`/api/v1/customers?search=${encodeURIComponent(mobile)}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(found.body.data.some((c: { mobile: string }) => c.mobile === mobile)).toBe(true);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "walkin.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();
  });

  it("registers an anonymous walk-in with no mobile (identity optional)", async () => {
    const res = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    expect(res.body.customerId).toBeNull();
    expect(res.body.customer).toBeNull();
  });

  it("drives the status machine (waiting→serving→completed) and rejects an illegal transition", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    const id = walkIn.body.id;

    // completing straight from waiting is not allowed
    const bad = await request()
      .post(`/api/v1/walk-ins/${id}/complete`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(bad.body.code).toBe("INVALID_STATUS_TRANSITION");

    const started = await request()
      .post(`/api/v1/walk-ins/${id}/start`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(started.body.status).toBe("serving");
    expect(started.body.servingStartedAt).toBeTruthy();

    const done = await request()
      .post(`/api/v1/walk-ins/${id}/complete`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(done.body.status).toBe("completed");
    expect(done.body.completedAt).toBeTruthy();
  });

  it("cancel is only reachable from waiting", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    await request().post(`/api/v1/walk-ins/${walkIn.body.id}/start`).set(auth(tenant.accessToken)).expect(201);

    const res = await request()
      .post(`/api/v1/walk-ins/${walkIn.body.id}/cancel`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(res.body.code).toBe("INVALID_STATUS_TRANSITION");

    const waiting = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    const cancelled = await request()
      .post(`/api/v1/walk-ins/${waiting.body.id}/cancel`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(cancelled.body.status).toBe("cancelled");
  });

  it("assigns and reassigns a barber, defaulting to Unassigned", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    expect(walkIn.body.barberStaffId).toBeNull();

    const assigned = await request()
      .patch(`/api/v1/walk-ins/${walkIn.body.id}/barber`)
      .set(auth(tenant.accessToken))
      .send({ barberStaffId: barberId })
      .expect(200);
    expect(assigned.body.barberStaffId).toBe(barberId);
    expect(assigned.body.barber.id).toBe(barberId);

    const unassigned = await request()
      .patch(`/api/v1/walk-ins/${walkIn.body.id}/barber`)
      .set(auth(tenant.accessToken))
      .send({ barberStaffId: null })
      .expect(200);
    expect(unassigned.body.barberStaffId).toBeNull();
  });

  it("rejects a barberStaffId that is not an active Barber at the branch", async () => {
    const notABarber = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);
    const res = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId], barberStaffId: notABarber.userId })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("returns KPI stats (in queue / serving / done today)", async () => {
    const res = await request()
      .get(`/api/v1/walk-ins/stats?branchId=${branchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(res.body).toHaveProperty("inQueue");
    expect(res.body).toHaveProperty("servingNow");
    expect(res.body).toHaveProperty("doneToday");
    expect(res.body).toHaveProperty("avgWaitMinutes");
  });

  it("a Barber (walkin.view only) cannot register a walk-in", async () => {
    const barberUser = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    await request().get("/api/v1/walk-ins").set(auth(barberUser.accessToken)).expect(200);
    const res = await request()
      .post("/api/v1/walk-ins")
      .set(auth(barberUser.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("branch-scoped user cannot register into a branch they are not assigned to", async () => {
    const otherBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Other Walk-in Branch"))
      .expect(201);
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);
    const res = await request()
      .post("/api/v1/walk-ins")
      .set(auth(receptionist.accessToken))
      .send({ branchId: otherBranch.body.id, serviceIds: [serviceId] })
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("edits entered details: re-snapshots totalMinor and relinks the customer by the new mobile", async () => {
    const oldMobile = `+968${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const newMobile = `+968${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId], mobileNumber: oldMobile, customerName: "Original Name" })
      .expect(201);
    expect(walkIn.body.totalMinor).toBe(6000);

    const updated = await request()
      .patch(`/api/v1/walk-ins/${walkIn.body.id}`)
      .set(auth(tenant.accessToken))
      .send({
        serviceIds: [serviceId, secondServiceId],
        mobileNumber: newMobile,
        customerName: "New Name",
      })
      .expect(200);
    expect(updated.body.totalMinor).toBe(8500);
    expect(updated.body.services).toHaveLength(2);
    expect(updated.body.customer.mobile).toBe(newMobile);
    expect(updated.body.customerName).toBe("New Name");

    // the previously-linked customer's own mobile is untouched
    const oldCustomer = await request()
      .get(`/api/v1/customers?search=${encodeURIComponent(oldMobile)}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(oldCustomer.body.data.some((c: { mobile: string }) => c.mobile === oldMobile)).toBe(true);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "walkin.updated", entityId: walkIn.body.id },
    });
    expect(entry).toBeTruthy();
  });

  it("rejects editing a walk-in that is already completed or cancelled", async () => {
    const completed = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    await request().post(`/api/v1/walk-ins/${completed.body.id}/start`).set(auth(tenant.accessToken)).expect(201);
    await request().post(`/api/v1/walk-ins/${completed.body.id}/complete`).set(auth(tenant.accessToken)).expect(201);

    const resCompleted = await request()
      .patch(`/api/v1/walk-ins/${completed.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ customerName: "Too Late" })
      .expect(409);
    expect(resCompleted.body.code).toBe("WALKIN_NOT_EDITABLE");

    const cancelled = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    await request().post(`/api/v1/walk-ins/${cancelled.body.id}/cancel`).set(auth(tenant.accessToken)).expect(201);

    const resCancelled = await request()
      .patch(`/api/v1/walk-ins/${cancelled.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ customerName: "Too Late" })
      .expect(409);
    expect(resCancelled.body.code).toBe("WALKIN_NOT_EDITABLE");
  });

  it("rejects an empty serviceIds array on edit", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);

    await request()
      .patch(`/api/v1/walk-ins/${walkIn.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ serviceIds: [] })
      .expect(400);
  });

  it("a Barber (walkin.view only) cannot edit a walk-in", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    const barberUser = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);

    const res = await request()
      .patch(`/api/v1/walk-ins/${walkIn.body.id}`)
      .set(auth(barberUser.accessToken))
      .send({ customerName: "Hacked" })
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("cross-tenant: another tenant cannot see or fetch a foreign walk-in", async () => {
    const mine = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);

    const other = await provisionTenant(app);
    const list = await request()
      .get("/api/v1/walk-ins?pageSize=100&branchId=" + branchId)
      .set(auth(other.accessToken))
      .expect(200);
    expect(list.body.data.every((w: { id: string }) => w.id !== mine.body.id)).toBe(true);

    const foreign = await request()
      .get(`/api/v1/walk-ins/${mine.body.id}`)
      .set(auth(other.accessToken))
      .expect(404);
    expect(foreign.body.code).toBe("NOT_FOUND");

    const missing = await request()
      .get(`/api/v1/walk-ins/${randomUUID()}`)
      .set(auth(tenant.accessToken))
      .expect(404);
    expect(missing.body.code).toBe("NOT_FOUND");
  });
});
