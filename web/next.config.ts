import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone — a self-contained server with only the modules the
  // app actually imports. Without it the container image carries all 660 MB of
  // node_modules, and web/Dockerfile's COPY of .next/standalone fails outright.
  output: "standalone",
};

export default nextConfig;
