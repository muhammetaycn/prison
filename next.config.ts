import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-only route indicator otherwise sits over the sidebar's PRISON wordmark.
  devIndicators: { position: "bottom-right" },
  // Pin the workspace root to this project (a stray lockfile higher up would otherwise be picked).
  turbopack: { root: process.cwd() },
};

export default nextConfig;
