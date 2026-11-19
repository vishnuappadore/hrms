import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

export type TxClient = Prisma.TransactionClient;

/**
 * The single database entry point for request-handling code.
 *
 * Usage:
 *   prisma.client.branch.findMany(...)                  // single reads/writes
 *   prisma.client.$transaction(async (tx) => { ... })    // multi-statement transactions
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: PrismaClient;

  constructor() {
    this.client = new PrismaClient();
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
