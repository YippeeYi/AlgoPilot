import type { NextConfig } from "next";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  webpack(config) {
    // Monaco ESM 内仍 vendored DOMPurify 3.4.15；override 单独不能替换它。
    // 精确替换其相对导入，使用锁文件中的官方 3.4.16 补丁。
    config.resolve.alias = {
      ...config.resolve.alias,
      "./dompurify/dompurify.js$": require.resolve("dompurify"),
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
