import { execSync } from "node:child_process";

/**
 * Integration-test global setup: point at local docker-compose services
 * (or CI service containers) and apply migrations on the owner connection.
 */
export default function setup() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL ??=
    "postgresql://hayryou_app:hayryou_dev@localhost:5432/hayryou";
  process.env.DIRECT_DATABASE_URL ??=
    "postgresql://hayryou_migrator:hayryou_dev@localhost:5432/hayryou";
  process.env.REDIS_URL ??= "redis://localhost:6379";
  process.env.JWT_ACCESS_SECRET ??= "test-access-secret-16chars";
  process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-16chars";
  process.env.S3_ENDPOINT ??= "http://localhost:9000";
  process.env.S3_REGION ??= "me-central-1";
  process.env.S3_ACCESS_KEY ??= "hayryou";
  process.env.S3_SECRET_KEY ??= "hayryou_dev";
  process.env.S3_UPLOADS_BUCKET ??= "hayryou-dev-uploads";

  execSync("npx prisma migrate deploy", {
    cwd: __dirname + "/..",
    stdio: "inherit",
    env: process.env,
  });
}
