import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gated deliverables are read through a DB-provided key that file tracing cannot follow (design 3, 9.10).
  outputFileTracingIncludes: {
    "/api/products/[id]/access": ["./src/server/deliverables/**/*"],
  },
};

export default nextConfig;
