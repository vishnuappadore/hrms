import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Shared ioredis client. Used for the POS idempotency guard (SETNX) and
 * available to future modules (permission cache, queues). One connection for
 * the app process; lazily connected.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  /**
   * Claim an idempotency key for `ttlSeconds`. Returns true if this caller won
   * the claim (first time), false if the key already existed (a replay).
   */
  async claim(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, "EX", ttlSeconds, "NX");
    return res === "OK";
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async onModuleDestroy(): Promise<void> {
    this.client.disconnect();
  }
}
