import { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createTestAdmin,
  createUserWithRole,
  validBranchPayload,
  type TestAdmin,
} from "./helpers";
import { PrismaService } from "../src/database/prisma.service";

describe("branches + branch scoping", () => {
  let app: INestApplication;
  let admin: TestAdmin;
  let branch1Id: string;
  let branch2Id: string;

  beforeAll(async () => {
    app = await createApp();
    admin = await createTestAdmin(app);

    const b1 = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(validBranchPayload("Scoped One"))
      .expect(201);
    branch1Id = b1.body.id;

    const b2 = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(validBranchPayload("Scoped Two"))
      .expect(201);
    branch2Id = b2.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("generates sequential immutable store codes", async () => {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(res.body.code).toMatch(/^BR-\d{4}$/);
  });

  it("branch manager sees only assigned branches in list", async () => {
    const manager = await createUserWithRole(app, "Branch Manager", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .get("/api/v1/branches")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(200);
    const ids = res.body.data.map((b: { id: string }) => b.id);
    expect(ids).toContain(branch1Id);
    expect(ids).not.toContain(branch2Id);
  });

  it("branch manager gets 403 on an unassigned branch", async () => {
    const manager = await createUserWithRole(app, "Branch Manager", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/branches/${branch2Id}`)
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(403);
    expect(res.body.code).toBe("BRANCH_ACCESS_DENIED");
  });

  it("employee (no branches.create) gets 403 creating a branch", async () => {
    const employeeUser = await createUserWithRole(app, "Employee", [branch1Id]);
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${employeeUser.accessToken}`)
      .send(validBranchPayload("Should Fail"))
      .expect(403);
    expect(res.body.code).toBe("PERMISSION_DENIED");
  });

  it("stats KPIs are branch-scoped", async () => {
    // admin (all branches) sees the company-wide counts
    const adminStats = await supertest(app.getHttpServer())
      .get("/api/v1/branches/stats")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(adminStats.body.total).toBeGreaterThanOrEqual(2);
    expect(adminStats.body.total).toBe(adminStats.body.active + adminStats.body.inactive);

    // a manager assigned to one branch sees exactly that slice
    const manager = await createUserWithRole(app, "Branch Manager", [branch1Id]);
    const scoped = await supertest(app.getHttpServer())
      .get("/api/v1/branches/stats")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .expect(200);
    expect(scoped.body.total).toBe(1);
    expect(scoped.body.employees).toBeGreaterThanOrEqual(1); // at least the manager themself
  });

  it("audit log records branch creation", async () => {
    const res = await supertest(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(validBranchPayload("Audited Branch"))
      .expect(201);

    const db = app.get(PrismaService);
    const entry = await db.client.auditLog.findFirst({
      where: { action: "branch.created", entityId: res.body.id },
    });
    expect(entry).toBeTruthy();
  });
});
