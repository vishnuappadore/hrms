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

describe("appointments", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let branchId: string;
  let serviceId: string;
  let barberId: string;

  const request = () => supertest(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** next occurrence of a given JS weekday (0=Sun..6=Sat), as YYYY-MM-DD */
  function nextWeekday(target: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  beforeAll(async () => {
    app = await createApp();
    tenant = await provisionTenant(app);

    const branch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Appt Branch"))
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
        durationMinutes: 45,
        priceMinor: 8500,
      })
      .expect(201);
    serviceId = service.body.id;

    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    barberId = barber.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  it("books an appointment: numbers it, snapshots the total, creates the customer, audits it", async () => {
    const mobile = `+968${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T10:00:00.000Z`,
        customerMobile: mobile,
        customerName: "Walk In Person",
      })
      .expect(201);

    expect(res.body.appointmentNo).toMatch(/^APT-\d{4}-\d{6}$/);
    expect(res.body.status).toBe("waiting");
    expect(res.body.totalMinor).toBe(8500);
    expect(res.body.currency).toBe("OMR");
    expect(res.body.durationMinutes).toBe(45);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.customer.mobile).toBe(mobile);

    // a customer record was created from the booking
    const found = await request()
      .get(`/api/v1/customers?search=${encodeURIComponent(mobile)}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(found.body.data.some((c: { mobile: string }) => c.mobile === mobile)).toBe(true);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "appointment.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();

    // Customer Details' visit-history list: GET /appointments?customerId= finds this booking
    const history = await request()
      .get(`/api/v1/appointments?customerId=${res.body.customer.id}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(history.body.data.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
  });

  it("books without a customer (identity optional per 2026 spec)", async () => {
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T11:00:00.000Z`,
      })
      .expect(201);
    expect(res.body.customerId).toBeNull();
    expect(res.body.customer).toBeNull();
  });

  it("books with only a name (no mobile): the name is preserved, not silently dropped", async () => {
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T11:30:00.000Z`,
        customerName: "Name Only Guest",
      })
      .expect(201);
    expect(res.body.customerId).toBeNull();
    expect(res.body.customer).toBeNull();
    expect(res.body.customerName).toBe("Name Only Guest");

    const fetched = await request()
      .get(`/api/v1/appointments/${res.body.id}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(fetched.body.customerName).toBe("Name Only Guest");

    const found = await request()
      .get(`/api/v1/appointments?search=${encodeURIComponent("Name Only Guest")}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(found.body.data.some((a: { id: string }) => a.id === res.body.id)).toBe(true);
  });

  it("drives the status machine and rejects an illegal transition", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T12:00:00.000Z`,
      })
      .expect(201);
    const id = appt.body.id;

    // completing straight from waiting is not allowed
    const bad = await request()
      .post(`/api/v1/appointments/${id}/complete`)
      .set(auth(tenant.accessToken))
      .expect(409);
    expect(bad.body.code).toBe("INVALID_STATUS_TRANSITION");

    await request().post(`/api/v1/appointments/${id}/confirm`).set(auth(tenant.accessToken)).expect(201);
    const started = await request()
      .post(`/api/v1/appointments/${id}/start`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(started.body.status).toBe("in_progress");
    const done = await request()
      .post(`/api/v1/appointments/${id}/complete`)
      .set(auth(tenant.accessToken))
      .expect(201);
    expect(done.body.status).toBe("completed");
  });

  it("edits an appointment's services, barber, and time; recomputes total/duration/end", async () => {
    const otherBarber = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    const category = await request()
      .post("/api/v1/service-categories")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Color", nameAr: "صبغ" })
      .expect(201);
    const otherService = await request()
      .post("/api/v1/services")
      .set(auth(tenant.accessToken))
      .send({
        categoryId: category.body.id,
        nameEn: "Hair Color",
        nameAr: "صبغ شعر",
        durationMinutes: 90,
        priceMinor: 15000,
      })
      .expect(201);

    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(2)}T09:00:00.000Z`,
      })
      .expect(201);
    const id = appt.body.id;
    const newStart = `${nextWeekday(2)}T10:00:00.000Z`;

    const updated = await request()
      .patch(`/api/v1/appointments/${id}`)
      .set(auth(tenant.accessToken))
      .send({
        barberId: otherBarber.userId,
        serviceIds: [otherService.body.id],
        scheduledStart: newStart,
      })
      .expect(200);

    expect(updated.body.barberId).toBe(otherBarber.userId);
    expect(updated.body.services).toHaveLength(1);
    expect(updated.body.services[0].serviceId).toBe(otherService.body.id);
    expect(updated.body.totalMinor).toBe(15000);
    expect(updated.body.durationMinutes).toBe(90);
    expect(new Date(updated.body.scheduledStart).toISOString()).toBe(new Date(newStart).toISOString());
    expect(new Date(updated.body.scheduledEnd).getTime() - new Date(updated.body.scheduledStart).getTime()).toBe(
      90 * 60_000,
    );

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const entry = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "appointment.updated", entityId: id },
    });
    expect(entry).toBeTruthy();
  });

  it("rejects editing a barberId that is not an active Barber at the branch", async () => {
    const notABarber = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(2)}T11:00:00.000Z`,
      })
      .expect(201);

    const res = await request()
      .patch(`/api/v1/appointments/${appt.body.id}`)
      .set(auth(tenant.accessToken))
      .send({ barberId: notABarber.userId })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("rejects editing an appointment that is no longer waiting/confirmed", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(2)}T12:00:00.000Z`,
      })
      .expect(201);
    const id = appt.body.id;
    await request().post(`/api/v1/appointments/${id}/cancel`).set(auth(tenant.accessToken)).expect(201);

    const res = await request()
      .patch(`/api/v1/appointments/${id}`)
      .set(auth(tenant.accessToken))
      .send({ scheduledStart: `${nextWeekday(2)}T13:00:00.000Z` })
      .expect(409);
    expect(res.body.code).toBe("APPOINTMENT_NOT_EDITABLE");
  });

  it("a Barber (appointments.view only) cannot edit an appointment", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(2)}T14:00:00.000Z`,
      })
      .expect(201);
    const barberUser = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    const res = await request()
      .patch(`/api/v1/appointments/${appt.body.id}`)
      .set(auth(barberUser.accessToken))
      .send({ scheduledStart: `${nextWeekday(2)}T15:00:00.000Z` })
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("cross-tenant: another tenant cannot edit a foreign appointment", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(2)}T16:00:00.000Z`,
      })
      .expect(201);
    const other = await provisionTenant(app);
    const res = await request()
      .patch(`/api/v1/appointments/${appt.body.id}`)
      .set(auth(other.accessToken))
      .send({ scheduledStart: `${nextWeekday(2)}T17:00:00.000Z` })
      .expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("slots: excludeAppointmentId keeps the appointment's own current slot from showing as taken", async () => {
    const date = nextWeekday(3);
    // slots are generated/compared in the API process's local time (see the
    // NOTE in listSlots()), so book via a slot's own `startsAt` rather than a
    // hand-picked UTC instant, exactly like the booking wizard does.
    const initial = await request()
      .get(`/api/v1/appointments/slots?branchId=${branchId}&barberId=${barberId}&date=${date}&durationMinutes=45`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const targetSlot = initial.body.find((s: { taken: boolean }) => !s.taken);

    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: targetSlot.startsAt,
      })
      .expect(201);

    const withoutExclude = await request()
      .get(`/api/v1/appointments/slots?branchId=${branchId}&barberId=${barberId}&date=${date}&durationMinutes=45`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const ownSlotWithoutExclude = withoutExclude.body.find((s: { time: string }) => s.time === targetSlot.time);
    expect(ownSlotWithoutExclude.taken).toBe(true);

    const withExclude = await request()
      .get(
        `/api/v1/appointments/slots?branchId=${branchId}&barberId=${barberId}&date=${date}&durationMinutes=45&excludeAppointmentId=${appt.body.id}`,
      )
      .set(auth(tenant.accessToken))
      .expect(200);
    const ownSlotWithExclude = withExclude.body.find((s: { time: string }) => s.time === targetSlot.time);
    expect(ownSlotWithExclude.taken).toBe(false);
  });

  it("lists barbers for the branch and flags the busy one", async () => {
    // start an appointment so the barber is mid-service
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T13:00:00.000Z`,
      })
      .expect(201);
    await request().post(`/api/v1/appointments/${appt.body.id}/confirm`).set(auth(tenant.accessToken));
    await request().post(`/api/v1/appointments/${appt.body.id}/start`).set(auth(tenant.accessToken));

    const barbers = await request()
      .get(`/api/v1/appointments/barbers?branchId=${branchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    const me = barbers.body.find((b: { id: string }) => b.id === barberId);
    expect(me).toBeTruthy();
    expect(me.busy).toBe(true);
  });

  it("generates slots on a working day and none on the weekly off day", async () => {
    // branch is closed on friday (validBranchPayload)
    const working = await request()
      .get(
        `/api/v1/appointments/slots?branchId=${branchId}&barberId=${barberId}&date=${nextWeekday(1)}&durationMinutes=45`,
      )
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(Array.isArray(working.body)).toBe(true);
    expect(working.body.length).toBeGreaterThan(0);
    expect(working.body[0]).toHaveProperty("time");
    expect(working.body[0]).toHaveProperty("taken");

    const off = await request()
      .get(
        `/api/v1/appointments/slots?branchId=${branchId}&barberId=${barberId}&date=${nextWeekday(5)}&durationMinutes=45`,
      )
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(off.body).toHaveLength(0);
  });

  it("returns the status-change history on the detail endpoint", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T17:00:00.000Z`,
      })
      .expect(201);
    await request().post(`/api/v1/appointments/${appt.body.id}/confirm`).set(auth(tenant.accessToken));

    const detail = await request()
      .get(`/api/v1/appointments/${appt.body.id}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(detail.body.history).toBeTruthy();
    expect(detail.body.history[0].toStatus).toBe("waiting");
    expect(detail.body.history.some((h: { toStatus: string }) => h.toStatus === "confirmed")).toBe(true);
  });

  it("rejects a barberId that is not an active Barber at the branch", async () => {
    // a Receptionist is a real tenant user but not a Barber
    const notABarber = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId: notABarber.userId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T18:00:00.000Z`,
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("list: a branch-scoped user cannot read another branch via ?branchId", async () => {
    const otherBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Scoped Other"))
      .expect(201);
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);

    // their own branch is fine
    await request()
      .get(`/api/v1/appointments?branchId=${branchId}`)
      .set(auth(receptionist.accessToken))
      .expect(200);

    // a branch they are not assigned to is refused, not silently served
    const denied = await request()
      .get(`/api/v1/appointments?branchId=${otherBranch.body.id}`)
      .set(auth(receptionist.accessToken))
      .expect(403);
    expect(denied.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("a Barber (appointments.view only) cannot book", async () => {
    const barberUser = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    await request().get("/api/v1/appointments").set(auth(barberUser.accessToken)).expect(200);
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(barberUser.accessToken))
      .send({ branchId, barberId, serviceIds: [serviceId], scheduledStart: `${nextWeekday(1)}T14:00:00.000Z` })
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("branch-scoped user cannot book into a branch they are not assigned to", async () => {
    const otherBranch = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Other Branch"))
      .expect(201);

    // Receptionist assigned only to the first branch
    const receptionist = await createUserWithRole(app, tenant.tenantId, "Receptionist", [branchId]);
    const res = await request()
      .post("/api/v1/appointments")
      .set(auth(receptionist.accessToken))
      .send({
        branchId: otherBranch.body.id,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T15:00:00.000Z`,
      })
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("cross-tenant: another tenant cannot see or fetch a foreign appointment", async () => {
    const mine = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(1)}T16:00:00.000Z`,
      })
      .expect(201);

    const other = await provisionTenant(app);
    const list = await request()
      .get("/api/v1/appointments?pageSize=100")
      .set(auth(other.accessToken))
      .expect(200);
    expect(list.body.data.every((a: { id: string }) => a.id !== mine.body.id)).toBe(true);

    const foreign = await request()
      .get(`/api/v1/appointments/${mine.body.id}`)
      .set(auth(other.accessToken))
      .expect(404);
    expect(foreign.body.code).toBe("NOT_FOUND");

    // an unknown id is NOT_FOUND, not a leak
    const missing = await request()
      .get(`/api/v1/appointments/${randomUUID()}`)
      .set(auth(tenant.accessToken))
      .expect(404);
    expect(missing.body.code).toBe("NOT_FOUND");
  });
});
