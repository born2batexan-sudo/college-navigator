/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    const header = (name, value) => ({ key: name, value });
    const securityHeaders = [
      header("Strict-Transport-Security", "max-age=31536000"),
      header("X-Content-Type-Options", "nosniff"),
      header("X-Frame-Options", "DENY"),
      header("Referrer-Policy", "strict-origin-when-cross-origin"),
      header("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
      header(
        "Content-Security-Policy",
        "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self' blob:; manifest-src 'self'; upgrade-insecure-requests",
      ),
    ];

    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/login",
        headers: [header("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")],
      },
    ];
  },
};

module.exports = nextConfig;
