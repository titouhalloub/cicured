import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source (see README).
  transpilePackages: ["@sft/schemas"],
};

export default nextConfig;
