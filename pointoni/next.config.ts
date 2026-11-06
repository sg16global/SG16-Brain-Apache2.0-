import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // scripts/smoke-ladder.sh builds its throwaway copy into its own directory so a
  // test run can never overwrite the live site's .next build.
  distDir: process.env.SG16_NEXT_DIST_DIR || ".next",

  // Allow the sandboxed live-preview hosts (https://<port>-*.e2b.app) to load
  // dev assets and call same-origin API routes without origin rejection.
  allowedDevOrigins: ["*.e2b.app"],

  // Real-scale CDN posture (Cloudflare, 7 domains): static heavy bytes stay
  // cached at the edge for a year. The FRIEND engine runtime + model weights
  // and all imagery are immutable per version, so a visitor in any of the
  // 109 countries pays only the first trip through the closest edge.
  // Baseline security headers on every route, including /api. HTTPS is the
  // only way the site is served (Cloudflare + Caddy both redirect), so HSTS is
  // safe from the first response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      {
        source: "/images/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
