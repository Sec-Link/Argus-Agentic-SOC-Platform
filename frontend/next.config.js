const path = require('path');

// Load repo-root .env first (frontend/../.env), then allow frontend/.env* to override.
// This keeps backend origin configuration in one place.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch {
  // ignore
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname),
  async rewrites() {
    const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:8000';
    return [
      // Django admin & platform pages
      { source: '/platform/:path*', destination: `${backendOrigin}/platform/:path*` },
      { source: '/admin/:path*', destination: `${backendOrigin}/admin/:path*` },

      // Static/media served by backend (WhiteNoise / MEDIA_ROOT)
      { source: '/static/:path*', destination: `${backendOrigin}/static/:path*` },
      { source: '/media/:path*', destination: `${backendOrigin}/media/:path*` },
    ];
  },
};

module.exports = nextConfig;
