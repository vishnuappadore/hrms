import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import Redis from "ioredis";
import { Public } from "../../common/decorators";
import { PrismaService } from "../../database/prisma.service";

/**
 * Liveness (/healthz) and readiness (/ready) — distinct endpoints on purpose:
 * they map 1:1 to ALB health checks today and K8s probes later.
 */
@Controller()
export class HealthController {
  private redis?: Redis;

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("healthz")
  healthz() {
    return { status: "ok" };
  }

  @Public()
  @Get("ready")
  async ready() {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      this.redis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      if (this.redis.status !== "ready") await this.redis.connect().catch(() => undefined);
      await this.redis.ping();
      return { status: "ready" };
    } catch {
      throw new ServiceUnavailableException({ status: "not_ready" });
    }
  }
}
