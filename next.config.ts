import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app (multiple lockfiles exist on the machine).
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
