import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    "@pancreator/runner-cursor",
    "@cursor/sdk",
    "@pancreator/intervention",
  ],
};

export default nextConfig;
