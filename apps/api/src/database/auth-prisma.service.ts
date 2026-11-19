import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * RLS-BYPASSING Prisma client (connects as the owner role via
 * DIRECT_DATABASE_URL). Login happens before a tenant is known, so the
 * users/refresh-token lookups cannot run through the tenant-scoped client.
 *
 * RULES — enforced in code review:
 *  - Injected ONLY by AuthService and TenantsService (provisioning).
 *  - Never used in request handlers after authentication.
 *  - Every query here must filter explicitly; there is no RLS safety net.
 */
@Injectable()
export class AuthPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: withPoolLimit(process.env.DIRECT_DATABASE_URL ?? "", 3) },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

function withPoolLimit(url: string, limit: number): string {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return url.includes("connection_limit") ? url : `${url}${sep}connection_limit=${limit}`;
}
