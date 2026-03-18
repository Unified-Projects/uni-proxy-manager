import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@uni-proxy-manager/ui",
  ],
};

export default nextConfig;
