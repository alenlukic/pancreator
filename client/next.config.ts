import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: "node_modules/.cache/next",
  serverExternalPackages: [
    "@pancreator/runner-cursor",
    "@cursor/sdk",
    "@pancreator/intervention",
  ],
};

export default nextConfig;
