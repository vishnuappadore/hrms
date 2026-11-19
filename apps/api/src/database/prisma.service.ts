import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { ClsService } from "nestjs-cls";
import { CLS_KEYS, getTenantId } from "../common/request-context";
import { createTenancyExtension } from "./tenancy.extension";

type TenantClient = ReturnType<PrismaService["buildClient"]>;
type TxClient = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/**
 * The tenant-scoped Prisma client — the ONLY database entry point for
 * request-handling code. Connects as the non-owner `hayryou_app` role, so RLS
 * applies; the tenancy extension injects the per-transaction tenant setting.
 *
 * Usage:
 *   prisma.client.branch.findMany(...)          // single reads/writes
 *   prisma.withTenantTx(async tx => { ... })    // multi-statement transactions
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  readonly client: TenantClient;

  constructor(private readonly cls: ClsService) {
    this.base = new PrismaClient();
    this.client = this.buildClient();
  }

  private buildClient() {
    return this.base.$extends(createTenancyExtension(this.cls));
  }

  /**
   * Multi-statement business transaction with tenant context.
   * ALWAYS use this (never base.$transaction) when a workflow writes more
   * than one row — the first statement pins app.tenant_id for the whole tx.
   */
  async withTenantTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const tenantId = getTenantId(this.cls);
    if (!tenantId) {
      throw new Error("withTenantTx called without tenant context");
    }
    return this.base.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * For background jobs / event listeners that run outside an HTTP request:
   * establishes CLS tenant context around `fn`.
   */
  async runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return this.cls.run(async () => {
      this.cls.set(CLS_KEYS.tenantId, tenantId);
      return fn();
    });
  }

  async onModuleInit() {
    await this.base.$connect();
  }

  async onModuleDestroy() {
    await this.base.$disconnect();
  }
}

export type { TxClient, Prisma };
