import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, createUserWithRole, provisionTenant, validBranchPayload, type TestTenant } from "./helpers";

describe("pos / checkout", () => {
  let app: INestApplication;
  let tenant: TestTenant;
  let branchId: string;
  let serviceId: string;
  let productId: string;
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
      .send(validBranchPayload("POS Branch"))
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
      .send({ categoryId: category.body.id, nameEn: "Haircut", nameAr: "قص", durationMinutes: 30, priceMinor: 10000 })
      .expect(201);
    serviceId = service.body.id;

    const product = await request()
      .post("/api/v1/products")
      .set(auth(tenant.accessToken))
      .send({ nameEn: "Pomade", sku: "SKU-1", salePriceMinor: 5000, costPriceMinor: 2000, openingStock: [{ branchId, quantity: 10 }] })
      .expect(201);
    productId = product.body.id;

    const barber = await createUserWithRole(app, tenant.tenantId, "Barber", [branchId]);
    barberId = barber.userId;
  });

  afterAll(async () => {
    await app.close();
  });

  async function stockOf(id: string): Promise<number> {
    const res = await request()
      .get(`/api/v1/products/${id}?branchId=${branchId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    return res.body.stockQuantity;
  }

  it("completes a sale: holds the money invariant, deducts stock, writes finance + audit", async () => {
    // 1 service (10000) + 2 products (2×5000) → subtotal 20000, VAT 5% = 1000, total 21000
    const res = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        items: [
          { type: "service", id: serviceId, quantity: 1 },
          { type: "product", id: productId, quantity: 2 },
        ],
        payments: [{ method: "cash", amountMinor: 21000 }],
      })
      .expect(201);

    expect(res.body.invoiceNo).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(res.body.subtotalMinor).toBe(20000);
    expect(res.body.taxMinor).toBe(1000);
    expect(res.body.totalMinor).toBe(21000);

    const lines = res.body.items.reduce((s: number, i: { lineTotalMinor: number }) => s + i.lineTotalMinor, 0);
    const paid = res.body.payments.reduce((s: number, p: { amountMinor: number }) => s + p.amountMinor, 0);
    expect(lines - res.body.discountMinor + res.body.taxMinor).toBe(res.body.totalMinor);
    expect(res.body.totalMinor).toBe(paid);

    expect(await stockOf(productId)).toBe(8);

    const { AuthPrismaService } = await import("../src/database/auth-prisma.service");
    const db = app.get(AuthPrismaService);
    const fin = await db.financeTransaction.findFirst({ where: { tenantId: tenant.tenantId, refId: res.body.id } });
    expect(fin?.direction).toBe("in");
    expect(fin?.category).toBe("sale_revenue");
    expect(Number(fin?.amountMinor)).toBe(21000);
    const audit = await db.auditLog.findFirst({
      where: { tenantId: tenant.tenantId, action: "pos.sale.completed", entityId: res.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it("applies a single manual discount before VAT", async () => {
    // subtotal 10000 − discount 2000 = 8000 taxable, VAT 400, total 8400
    const res = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        discountMinor: 2000,
        payments: [{ method: "card", amountMinor: 8400 }],
      })
      .expect(201);
    expect(res.body.discountMinor).toBe(2000);
    expect(res.body.taxMinor).toBe(400);
    expect(res.body.totalMinor).toBe(8400);
  });

  it("rejects a split payment that does not sum to the total", async () => {
    const res = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        payments: [
          { method: "cash", amountMinor: 5000 },
          { method: "card", amountMinor: 3000 },
        ],
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("idempotency: a replay with the same key returns the same invoice and does not double-deduct", async () => {
    const key = randomUUID();
    const body = {
      branchId,
      items: [{ type: "product", id: productId, quantity: 1 }],
      payments: [{ method: "cash", amountMinor: 5250 }], // 5000 + 5% VAT 250
    };
    const first = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .set("idempotency-key", key)
      .send(body)
      .expect(201);
    const after = await stockOf(productId);

    const replay = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .set("idempotency-key", key)
      .send(body)
      .expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.invoiceNo).toBe(first.body.invoiceNo);
    expect(await stockOf(productId)).toBe(after);
  });

  it("concurrent checkouts each get a distinct invoice number (no unique-index 500s)", async () => {
    // Service-only so the product stock row lock doesn't serialize these for us — only the
    // invoice-numbering advisory lock stands between them and a duplicate (tenant_id, invoice_no).
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request()
          .post("/api/v1/pos/checkout")
          .set(auth(tenant.accessToken))
          .send({
            branchId,
            items: [{ type: "service", id: serviceId, quantity: 1 }],
            payments: [{ method: "cash", amountMinor: 10500 }],
          }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const numbers = results.map((r) => r.body.invoiceNo as string);
    expect(new Set(numbers).size).toBe(8);
  });

  it("blocks a sale exceeding available stock (no negative stock)", async () => {
    const before = await stockOf(productId);
    const qty = before + 100;
    // unit 5000 + clean 5% VAT (250) per unit → total 5250 × qty (matches total so
    // the request reaches the stock check rather than the payment-sum guard)
    const res = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        items: [{ type: "product", id: productId, quantity: qty }],
        payments: [{ method: "cash", amountMinor: 5250 * qty }],
      })
      .expect(409);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(await stockOf(productId)).toBe(before); // rolled back
  });

  it("a branch-scoped user cannot check out into an unassigned branch", async () => {
    const other = await request()
      .post("/api/v1/branches")
      .set(auth(tenant.accessToken))
      .send(validBranchPayload("Other POS"))
      .expect(201);
    const cashier = await createUserWithRole(app, tenant.tenantId, "Cashier", [branchId]);
    const res = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(cashier.accessToken))
      .send({
        branchId: other.body.id,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 10500 }],
      })
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("entry point 3: checking out a walk-in queue entry marks it Completed and links the invoice", async () => {
    const walkIn = await request()
      .post("/api/v1/walk-ins")
      .set(auth(tenant.accessToken))
      .send({ branchId, serviceIds: [serviceId] })
      .expect(201);
    await request().post(`/api/v1/walk-ins/${walkIn.body.id}/start`).set(auth(tenant.accessToken)).expect(201);

    const invoice = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        walkInId: walkIn.body.id,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 10500 }],
      })
      .expect(201);
    expect(invoice.body.walkInId).toBe(walkIn.body.id);

    const updated = await request()
      .get(`/api/v1/walk-ins/${walkIn.body.id}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(updated.body.status).toBe("completed");
    expect(updated.body.invoiceId).toBe(invoice.body.id);
  });

  it("checking out a completed appointment links the invoice and blocks a second checkout", async () => {
    const appt = await request()
      .post("/api/v1/appointments")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        barberId,
        serviceIds: [serviceId],
        scheduledStart: `${nextWeekday(3)}T10:00:00.000Z`,
      })
      .expect(201);
    const appointmentId = appt.body.id;
    await request().post(`/api/v1/appointments/${appointmentId}/confirm`).set(auth(tenant.accessToken)).expect(201);
    await request().post(`/api/v1/appointments/${appointmentId}/start`).set(auth(tenant.accessToken)).expect(201);
    await request().post(`/api/v1/appointments/${appointmentId}/complete`).set(auth(tenant.accessToken)).expect(201);

    const invoice = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        appointmentId,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 10500 }],
      })
      .expect(201);
    expect(invoice.body.appointmentId).toBe(appointmentId);

    const updated = await request()
      .get(`/api/v1/appointments/${appointmentId}`)
      .set(auth(tenant.accessToken))
      .expect(200);
    expect(updated.body.status).toBe("completed");
    expect(updated.body.invoiceId).toBe(invoice.body.id);

    // a second checkout against the same, already-invoiced appointment must be rejected,
    // not silently create a second invoice (the bug this test guards against)
    const replay = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({
        branchId,
        appointmentId,
        items: [{ type: "service", id: serviceId, quantity: 1 }],
        payments: [{ method: "cash", amountMinor: 10500 }],
      })
      .expect(409);
    expect(replay.body.code).toBe("INVALID_STATUS_TRANSITION");
  });

  it("cross-tenant: another tenant cannot fetch this tenant's invoice", async () => {
    const mine = await request()
      .post("/api/v1/pos/checkout")
      .set(auth(tenant.accessToken))
      .send({ branchId, items: [{ type: "service", id: serviceId, quantity: 1 }], payments: [{ method: "cash", amountMinor: 10500 }] })
      .expect(201);

    const outsider = await provisionTenant(app);
    const res = await request()
      .get(`/api/v1/pos/invoices/${mine.body.id}`)
      .set(auth(outsider.accessToken))
      .expect(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
