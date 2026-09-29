/** @type {import('next').NextConfig} */
const STRICT_TRANSPORT_SECURITY_HEADER = "Strict-Transport-Security";

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: STRICT_TRANSPORT_SECURITY_HEADER, value: "max-age=31536000" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
