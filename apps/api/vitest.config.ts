import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC plugin is required: Nest decorators need emitDecoratorMetadata,
// which vitest's default esbuild transform cannot produce.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
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
