import "reflect-metadata";
import { Queue, Worker } from "bullmq";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { PrismaService } from "./database/prisma.service";
import { runLeaveAccrualJob } from "./modules/leave/leave-accrual.job";

/**
 * BullMQ worker entrypoint — same Docker image as the API, different CMD
 * (node dist/worker.js). Queues: notifications, exports, scheduled.
 *
 * Bootstraps a Nest application context (no HTTP listener) so job processors can use the same
 * injectable services request handlers do. First real processor: leave-accrual, on the
 * `scheduled` queue; `notifications`/`exports` stay stub loggers until their modules land
 * (docs/ROADMAP.md).
 */
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
// plain options (not an ioredis instance) — BullMQ manages its own connections
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password ? { password: redisUrl.password } : {}),
  maxRetriesPerRequest: null,
};

const STUB_QUEUES = ["notifications", "exports"] as const;

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);

  const scheduled = new Queue("scheduled", { connection });
  await scheduled.upsertJobScheduler("heartbeat", { pattern: "*/5 * * * *" }, { name: "heartbeat", data: {} });
  // Daily at 01:00 UTC — ample margin after midnight for "today" to have rolled over.
  await scheduled.upsertJobScheduler("leave-accrual", { pattern: "0 1 * * *" }, { name: "leave-accrual", data: {} });

  const scheduledWorker = new Worker(
    "scheduled",
    async (job) => {
      if (job.name === "leave-accrual") {
        await runLeaveAccrualJob(prisma);
        return;
      }
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ queue: "scheduled", job: job.name, id: job.id }));
    },
    { connection },
  );

  const stubWorkers = STUB_QUEUES.map(
    (name) =>
      new Worker(
        name,
        async (job) => {
          // eslint-disable-next-line no-console
          console.log(JSON.stringify({ queue: name, job: job.name, id: job.id }));
        },
        { connection },
      ),
  );

  const shutdown = async () => {
    await Promise.all([scheduledWorker, ...stubWorkers].map((w) => w.close()));
    await scheduled.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: "worker started", queues: ["scheduled", ...STUB_QUEUES] }));
}

void main();
