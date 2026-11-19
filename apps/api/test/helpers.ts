import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as argon2 from "argon2";
import supertest from "supertest";
import { randomUUID } from "node:crypto";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";

export interface TestAdmin {
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

/**
 * Single-tenant app: there is one global set of roles (seeded once, see
 * `database/seed.ts`). Each call creates a fresh Super Admin user (unique
 * email) so tests stay independent without needing per-test tenants.
 */
export async function createTestAdmin(app: INestApplication): Promise<TestAdmin> {
  const prisma = app.get(PrismaService);
  const suffix = randomUUID().slice(0, 8);
  const adminEmail = `admin-${suffix}@test.keystonehr`;
  const password = "Test@12345";

  const superAdminRole = await prisma.client.role.findFirstOrThrow({
    where: { nameEn: "Super Admin" },
  });

  await prisma.client.user.create({
    data: {
      name: "Test Admin",
      email: adminEmail,
      username: `admin-${suffix}`,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleId: superAdminRole.id,
      allBranches: true,
    },
  });

  const res = await supertest(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ identifier: adminEmail, password })
    .expect(200);

  return { adminEmail, password, accessToken: res.body.tokens.accessToken };
}

/** Create a non-admin user with a given system role and branch assignments. */
export async function createUserWithRole(
  app: INestApplication,
  roleName: string,
  branchIds: string[],
): Promise<{ accessToken: string; userId: string }> {
  const prisma = app.get(PrismaService);
  const role = await prisma.client.role.findFirstOrThrow({ where: { nameEn: roleName } });
  const suffix = randomUUID().slice(0, 8);
  const password = "Test@12345";
  const user = await prisma.client.user.create({
    data: {
      name: `${roleName} ${suffix}`,
      email: `${roleName.toLowerCase().replace(/\s/g, "-")}-${suffix}@test.keystonehr`,
      username: `user-${suffix}`,
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      roleId: role.id,
      allBranches: false,
      branchAssignments: { create: branchIds.map((branchId) => ({ branchId })) },
    },
  });

  const res = await supertest(app.getHttpServer())
    .post("/api/v1/auth/login")
    .send({ identifier: user.email, password })
    .expect(200);

  return { accessToken: res.body.tokens.accessToken, userId: user.id };
}

export const validBranchPayload = (name: string) => ({
  nameEn: name,
  nameAr: `فرع ${name}`,
  mobile: `+9715${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`,
  email: `${name.toLowerCase().replace(/\s/g, "-")}@test.keystonehr`,
  country: "United Arab Emirates",
  state: "Dubai",
  city: "Dubai",
  address: "Test Street 1",
  workingHours: { openingTime: "09:00", closingTime: "18:00", weeklyOffDays: ["friday", "saturday"] },
});
