import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The dev/prod rewrite proxy defaults to a 30s upstream timeout, which is
    // shorter than the backend copilot's 45s LLM budget. Keep this above the
    // backend timeout (and aligned with the 60s apiPost timeout in
    // Decisions.tsx) so slow LLM answers / deterministic fallbacks reach the
    // client instead of being killed at the proxy.
    proxyTimeout: 60_000,
  },
  async rewrites() {
    const api = process.env.API_PROXY_TARGET || "http://localhost:4000";
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/health", destination: `${api}/health` },
    ];
  },
};

export default nextConfig;
