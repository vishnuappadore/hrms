import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone", // small Docker images (see docs/INFRA.md)
  eslint: { ignoreDuringBuilds: true }, // linting runs via `pnpm lint` (flat config)
  typescript: { ignoreBuildErrors: false },
};

export default withNextIntl(nextConfig);
