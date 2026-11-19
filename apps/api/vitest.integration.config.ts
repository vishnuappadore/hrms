import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// Integration tests need real Postgres + Redis (docker compose up) and
// migrations applied (pnpm db:migrate). They run serially: they share a DB.
export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    globalSetup: "./test/global-setup.ts",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
});
