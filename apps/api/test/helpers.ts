import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { AuthPrismaService } from "../src/database/auth-prisma.service";
import { TenantsService } from "../src/modules/tenants/tenants.service";

export interface TestTenant {
  tenantId: string;
  adminEmail: string;
  password: string;
  accessToken: string;
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1", { exclude: ["healthz", "ready"] });
  await app.init();
  return app;
}

/** Provision a fresh tenant with a unique slug and return a logged-in admin. */
export async function provisionTenant(app: INestApplication): Promise<TestTenant> {
  const tenants = app.get(TenantsService);
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `admin-${suffix}@test.hayryou`;
  const password = "Test@12345";

  const { tenant } = await tenants.provisionTenant({
    name: `Test Tenant ${suffix}`,
    slug: `test-${suffix}`,
    admin: { name: "Test Admin", email: adminEmail, username: `admin-${suffix}`, password },
  });

  const res = await supertest(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ identifier: adminEmail, password })
    .expect(200);

  return { tenantId: tenant.id, adminEmail, password, accessToken: res.body.tokens.accessToken };
}

/** Create a non-admin user with a given system role and branch assignments. */
export async function createUserWithRole(
  app: INestApplication,
  tenantId: string,
  roleName: string,
  branchIds: string[],
): Promise<{ accessToken: string; userId: string }> {
  const db = app.get(AuthPrismaService);
  const role = await db.role.findFirstOrThrow({ where: { tenantId, nameEn: roleName } });
  const suffix = randomUUID().slice(0, 8);
  const password = "Test@12345";
  const user = await db.user.create({
    data: {
      tenantId,
      name: `${roleName} ${suffix}`,
      email: `${roleName.toLowerCase().replace(/\s/g, "-")}-${suffix}@test.hayryou`,
      username: `user-${suffix}`,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleId: role.id,
      allBranches: false,
      branchAssignments: { create: branchIds.map((branchId) => ({ tenantId, branchId })) },
    },
  });

  const res = await supertest(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ identifier: user.email, password })
    .expect(200);

  return { accessToken: res.body.tokens.accessToken, userId: user.id };
}

/** A valid create-customer payload with a fresh unique mobile each call. */
export const validCustomerPayload = (overrides: Record<string, unknown> = {}) => ({
  mobile: `+968${Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0")}`,
  name: "Test Customer",
  email: null,
  ...overrides,
});

export const validBranchPayload = (name: string) => ({
  nameEn: name,
  nameAr: `فرع ${name}`,
  type: "corporate",
  mobile: "+96890001111",
  email: `${name.toLowerCase().replace(/\s/g, "-")}@test.hayryou`,
  country: "Oman",
  state: "Muscat",
  city: "Muscat",
  address: "Test Street 1",
  workingHours: { openingTime: "09:00", closingTime: "21:00", weeklyOffDays: ["friday"] },
});
