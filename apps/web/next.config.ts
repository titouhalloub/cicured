import type { NextConfig } from "next";

// Server-side proxy target. The Next.js server runs inside the Codespace and
// reaches the API directly at localhost — it must NOT go through the public
// tunnel (that returns a 308 redirect loop). NEXT_PUBLIC_API_URL is
// intentionally not used here: the browser talks to /api on its own origin.
const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Workspace packages are consumed as TypeScript source (see README).
  transpilePackages: ["@sft/schemas"],
  async rewrites() {
    return [
      {
        // The negative lookahead keeps /api/runs/<id>/logs OUT of the
        // buffering rewrite layer; the dedicated route handler
        // app/api/runs/[id]/logs/route.ts streams it instead.
        source: "/api/:path((?!runs/[^/]+/logs).*)",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
