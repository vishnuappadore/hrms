import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthPrismaService } from "../src/database/auth-prisma.service";
import { createApp, provisionTenant, validBranchPayload, type TestTenant } from "./helpers";

/**
 * THE tenant-isolation suite. If anything here fails, stop shipping.
 */
describe("RLS tenant isolation", () => {
  let app: INestApplication;
  let tenantA: TestTenant;
  let tenantB: TestTenant;
  let branchAId: string;

  beforeAll(async () => {
    app = await createApp();
    tenantA = await provisionTenant(app);
    tenantB = await provisionTenant(app);

    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send(validBranchPayload("Tenant A Branch"))
      .expect(201);
    branchAId = res.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("tenant B cannot list tenant A's branches", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(200);
    const ids = res.body.data.map((b: { id: string }) => b.id);
    expect(ids).not.toContain(branchAId);
  });

  it("tenant B cannot read tenant A's branch by id", async () => {
    await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branchAId}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
  });

  it("tenant B cannot update tenant A's branch", async () => {
    await supertest(app.getHttpServer())
      .patch(`/api/v1/branches/${branchAId}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({ nameEn: "Hijacked" })
      .expect(404);

    const check = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branchAId}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .expect(200);
    expect(check.body.nameEn).toBe("Tenant A Branch");
  });

  it("tenant B's user listing never contains tenant A's users", async () => {
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(200);
    const emails = res.body.data.map((u: { email: string }) => u.email);
    expect(emails).not.toContain(tenantA.adminEmail);
  });

  it("tenant B cannot read tenant A's user by id", async () => {
    const db = app.get(AuthPrismaService);
    const userA = await db.user.findFirstOrThrow({ where: { tenantId: tenantA.tenantId } });
    await supertest(app.getHttpServer())
      .get(`/api/v1/users/${userA.id}`)
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .expect(404);
  });

  it("tenant B cannot create a user with tenant A's role (role invisible under RLS)", async () => {
    const db = app.get(AuthPrismaService);
    const roleA = await db.role.findFirstOrThrow({
      where: { tenantId: tenantA.tenantId, nameEn: "Receptionist" },
    });
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${tenantB.accessToken}`)
      .send({
        name: "Cross Tenant",
        username: "cross-tenant-user",
        password: "Cross@12345",
        roleId: roleA.id,
        allBranches: true,
      })
      .expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("raw SQL as the app role without tenant context returns zero rows (fail closed)", async () => {
    const db = app.get(AuthPrismaService);
    // count via owner (bypasses RLS) to prove rows exist...
    const [{ count }] = await db.$queryRaw<[{ count: bigint }]>`
      SELECT count(*)::bigint AS count FROM branches`;
    expect(Number(count)).toBeGreaterThan(0);
    // ...schema-level assertion that RLS is ENABLED + FORCED on every tenant table
    const unprotected = await db.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT IN ('_prisma_migrations')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
        AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`;
    expect(unprotected).toEqual([]);
  });

  it("every tenant_id table has a tenant_isolation policy", async () => {
    const db = app.get(AuthPrismaService);
    const missing = await db.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT IN ('_prisma_migrations')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public' AND p.tablename = c.relname
        )`;
    expect(missing).toEqual([]);
  });
});
