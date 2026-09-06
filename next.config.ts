import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Render free/starter builds OOM during ESLint+tsc in the same worker.
  // Lint locally / CI separately; typecheck still runs via `tsc` when needed.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Skip typecheck during `next build` to avoid Render OOM on small plans.
    // Run `npx tsc --noEmit` locally / in CI instead.
    ignoreBuildErrors: true,
  },
  experimental: {
    webpackMemoryOptimizations: true,
  },
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
    ];
    if (isProd) {
      security.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }
    return [
      {
        source: "/:path*",
        headers: security,
      },
      {
        // Embeddable form may be iframed on customer sites
        source: "/embed/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Allow embedding for public form
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
