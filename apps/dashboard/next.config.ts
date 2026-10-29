import type { NextConfig } from "next";

const backendUrl = (
  process.env.API_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["10.0.9.247"],

  async rewrites() {
    return [
      {
        source: "/api/backend/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
