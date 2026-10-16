import type { NextConfig } from 'next';

// standalone: the Docker image runs .next/standalone's server.js with only the files the build traced.
const config: NextConfig = {
  output: 'standalone',
  // Uploads reach the api through a server action: a 4 MiB file plus multipart overhead, under Vercel's 4.5 MB cap.
  experimental: { serverActions: { bodySizeLimit: '4.5mb' } },
  async headers() {
    const security = [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ];
    return [{ source: '/:path*', headers: security }];
  },
};

export default config;
